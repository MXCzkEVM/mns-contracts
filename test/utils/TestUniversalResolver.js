const { solidity } = require('ethereum-waffle')
const { use, expect } = require('chai')
const namehash = require('eth-ens-namehash')
const { hexDataSlice } = require('ethers/lib/utils')
const sha3 = require('web3-utils').sha3
const { Contract } = require('ethers')
const { ethers } = require('hardhat')
const { dns } = require('../test-utils')
const { writeFile } = require('fs/promises')
const { deploy } = require('../test-utils/contracts')

use(solidity)

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const EMPTY_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000'

contract('UniversalResolver', function (accounts) {
  let ENSRegistry,
    PublicResolver,
    NameWrapper,
    UniversalResolver,
    DummyOffchainResolver,
    LegacyResolver,
    ReverseRegistrar
  let ens,
    publicResolver,
    /**
     * @type {Contract}
     */
    universalResolver,
    dummyOffchainResolver,
    nameWrapper,
    reverseRegistrar,
    reverseNode,
    batchGateway,
    dummyOldResolver

  before(async () => {
    batchGateway = (await ethers.getContractAt('BatchGateway', ZERO_ADDRESS))
      .interface
    ENSRegistry = await ethers.getContractFactory('ENSRegistry')
    PublicResolver = await ethers.getContractFactory('PublicResolver')
    NameWrapper = await ethers.getContractFactory('DummyNameWrapper')
    UniversalResolver = await ethers.getContractFactory('UniversalResolver')
    DummyOffchainResolver = await ethers.getContractFactory(
      'DummyOffchainResolver',
    )
    LegacyResolver = await ethers.getContractFactory('LegacyResolver')
    ReverseRegistrar = await ethers.getContractFactory('ReverseRegistrar')
  })

  beforeEach(async () => {
    node = namehash.hash('mxc')
    ens = await deploy('ENSRegistry')
    nameWrapper = await deploy('DummyNameWrapper')
    reverseRegistrar = await deploy('ReverseRegistrar', ens.address)
    reverseNode = accounts[0].toLowerCase().substring(2) + '.addr.reverse'
    oldResolverReverseNode =
      accounts[10].toLowerCase().substring(2) + '.addr.reverse'
    await ens.setSubnodeOwner(EMPTY_BYTES32, sha3('reverse'), accounts[0], {
      from: accounts[0],
    })
    await ens.setSubnodeOwner(
      namehash.hash('reverse'),
      sha3('addr'),
      reverseRegistrar.address,
      { from: accounts[0] },
    )
    publicResolver = await deploy(
      'PublicResolver',
      ens.address,
      nameWrapper.address,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
    )
    universalResolver = await deploy('UniversalResolver', ens.address, [
      'http://universal-offchain-resolver.local/',
    ])
    dummyOffchainResolver = await deploy('DummyOffchainResolver')
    dummyOldResolver = await deploy('DummyOldResolver')

    await ens.setSubnodeOwner(EMPTY_BYTES32, sha3('mxc'), accounts[0], {
      from: accounts[0],
    })
    await ens.setSubnodeOwner(namehash.hash('mxc'), sha3('test'), accounts[0], {
      from: accounts[0],
    })
    await ens.setResolver(namehash.hash('test.mxc'), publicResolver.address, {
      from: accounts[0],
    })
    await ens.setSubnodeOwner(
      namehash.hash('test.mxc'),
      sha3('sub'),
      accounts[0],
      { from: accounts[0] },
    )
    await ens.setResolver(namehash.hash('sub.test.mxc'), accounts[1], {
      from: accounts[0],
    })
    await publicResolver.functions['setAddr(bytes32,address)'](
      namehash.hash('test.mxc'),
      accounts[1],
      { from: accounts[0] },
    )
    await publicResolver.functions['setText(bytes32,string,string)'](
      namehash.hash('test.mxc'),
      'foo',
      'bar',
      { from: accounts[0] },
    )
    await ens.setSubnodeOwner(
      namehash.hash('test.mxc'),
      sha3('offchain'),
      accounts[0],
      { from: accounts[0] },
    )
    await ens.setSubnodeOwner(
      namehash.hash('test.mxc'),
      sha3('no-resolver'),
      accounts[0],
      { from: accounts[0] },
    )
    let name = 'test.mxc'
    for (let i = 0; i < 5; i += 1) {
      const parent = name
      const label = `sub${i}`
      await ens.setSubnodeOwner(
        namehash.hash(parent),
        sha3(label),
        accounts[0],
        { from: accounts[0] },
      )
      name = `${label}.${parent}`
    }
    await ens.setResolver(
      namehash.hash('offchain.test.mxc'),
      dummyOffchainResolver.address,
      { from: accounts[0] },
    )

    await reverseRegistrar.claim(accounts[0], {
      from: accounts[0],
    })
    await ens.setResolver(namehash.hash(reverseNode), publicResolver.address, {
      from: accounts[0],
    })
    await publicResolver.setName(namehash.hash(reverseNode), 'test.mxc')

    const oldResolverSigner = await ethers.getSigner(accounts[10])
    const _reverseRegistrar = reverseRegistrar.connect(oldResolverSigner)
    const _ens = ens.connect(oldResolverSigner)

    await _reverseRegistrar.claim(accounts[10])
    await _ens.setResolver(
      namehash.hash(oldResolverReverseNode),
      dummyOldResolver.address,
    )
  })

  const resolveCallbackSig = ethers.utils.hexDataSlice(
    ethers.utils.id('resolveCallback(bytes,bytes)'),
    0,
    4,
  )

  describe('findResolver()', () => {
    it('should find an exact match resolver', async () => {
      const result = await universalResolver.findResolver(
        dns.hexEncodeName('test.mxc'),
      )
      expect(result['0']).to.equal(publicResolver.address)
    })

    it('should find a resolver on a parent name', async () => {
      const result = await universalResolver.findResolver(
        dns.hexEncodeName('foo.test.mxc'),
      )
      expect(result['0']).to.equal(publicResolver.address)
    })

    it('should choose the resolver closest to the leaf', async () => {
      const result = await universalResolver.findResolver(
        dns.hexEncodeName('sub.test.mxc'),
      )
      expect(result['0']).to.equal(accounts[1])
    })
    it('should allow encrypted labels', async () => {
      const result = await universalResolver.callStatic.findResolver(
        dns.hexEncodeName(
          '[9c22ff5f21f0b81b113e63f7db6da94fedef11b2119b4088b89664fb9a3cb658].mxc',
        ),
      )
      expect(result['0']).to.equal(publicResolver.address)
    })
    it('should return the final offset for the found resolver', async () => {
      const result = await universalResolver.findResolver(
        dns.hexEncodeName('foo.test.mxc'),
      )
      expect(result['2']).to.equal(4)
    })
    it('should find a resolver many levels up', async () => {
      const result = await universalResolver.findResolver(
        dns.hexEncodeName('sub4.sub3.sub2.sub1.sub0.test.mxc'),
      )
      expect(result['0']).to.equal(publicResolver.address)
      expect(result['2']).to.equal(25)
    })
  })

  describe('resolve()', () => {
    it('should resolve a record via legacy methods', async () => {
      const data = publicResolver.interface.encodeFunctionData(
        'addr(bytes32)',
        [namehash.hash('test.mxc')],
      )

      const result = await universalResolver['resolve(bytes,bytes)'](
        dns.hexEncodeName('test.mxc'),
        data,
      )
      const [ret] = ethers.utils.defaultAbiCoder.decode(
        ['address'],
        result['0'],
      )
      expect(ret).to.equal(accounts[1])
    })

    it('should throw if a resolver is not set on the queried name, and the found resolver does not support resolve()', async () => {
      const data = publicResolver.interface.encodeFunctionData(
        'addr(bytes32)',
        [namehash.hash('no-resolver.test.mxc')],
      )

      await expect(
        universalResolver['resolve(bytes,bytes)'](
          dns.hexEncodeName('no-resolver.test.mxc'),
          data,
        ),
      ).to.be.revertedWith(
        'UniversalResolver: Wildcard on non-extended resolvers is not supported',
      )
    })

    it('should resolve a record if `supportsInterface` throws', async () => {
      const legacyResolver = await LegacyResolver.deploy()
      await ens.setSubnodeOwner(
        namehash.hash('mxc'),
        sha3('test2'),
        accounts[0],
        { from: accounts[0] },
      )
      await ens.setResolver(
        namehash.hash('test2.mxc'),
        legacyResolver.address,
        { from: accounts[0] },
      )
      const data = publicResolver.interface.encodeFunctionData(
        'addr(bytes32)',
        [namehash.hash('test.mxc')],
      )
      const result = await universalResolver['resolve(bytes,bytes)'](
        dns.hexEncodeName('test2.mxc'),
        data,
      )
      const [ret] = ethers.utils.defaultAbiCoder.decode(
        ['address'],
        result['0'],
      )
      expect(ret).to.equal(legacyResolver.address)
    })

    it('should return a wrapped revert if the resolver reverts with OffchainLookup', async () => {
      const data = publicResolver.interface.encodeFunctionData(
        'addr(bytes32)',
        [namehash.hash('offchain.test.mxc')],
      )

      // OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData)
      // This is the extraData value the universal resolver should encode
      const extraData = ethers.utils.defaultAbiCoder.encode(
        ['bool', 'address', 'string[]', 'bytes', '(bytes4,bytes)[]'],
        [
          false,
          dummyOffchainResolver.address,
          ['http://universal-offchain-resolver.local/'],
          '0x',
          [[resolveCallbackSig, data]],
        ],
      )

      const callData = batchGateway.encodeFunctionData('query', [
        [[dummyOffchainResolver.address, ['https://example.com/'], data]],
      ])

      try {
        await universalResolver['resolve(bytes,bytes)'](
          dns.hexEncodeName('offchain.test.mxc'),
          data,
        )
      } catch (e) {
        expect(e.errorName).to.equal('OffchainLookup')
        expect(e.errorArgs.sender).to.equal(universalResolver.address)
        expect(e.errorArgs.urls).to.deep.equal([
          'http://universal-offchain-resolver.local/',
        ])
        expect(e.errorArgs.callData).to.equal(callData)
        expect(e.errorArgs.callbackFunction).to.equal(
          ethers.utils.hexDataSlice(
            ethers.utils.id('resolveSingleCallback(bytes,bytes)'),
            0,
            4,
          ),
        )
        expect(e.errorArgs.extraData).to.equal(extraData)
      }
    })
    it('should use custom gateways when specified', async () => {
      const data = publicResolver.interface.encodeFunctionData(
        'addr(bytes32)',
        [namehash.hash('offchain.test.mxc')],
      )
      try {
        await universalResolver['resolve(bytes,bytes,string[])'](
          dns.hexEncodeName('offchain.test.mxc'),
          data,
          ['https://custom-offchain-resolver.local/'],
        )
      } catch (e) {
        expect(e.errorArgs.urls).to.deep.equal([
          'https://custom-offchain-resolver.local/',
        ])
      }
    })

    describe('batch', () => {
      it('should resolve multiple records onchain', async () => {
        const textData = publicResolver.interface.encodeFunctionData(
          'text(bytes32,string)',
          [namehash.hash('test.mxc'), 'foo'],
        )
        const addrData = publicResolver.interface.encodeFunctionData(
          'addr(bytes32)',
          [namehash.hash('test.mxc')],
        )
        const [[textEncoded, addrEncoded]] = await universalResolver[
          'resolve(bytes,bytes[])'
        ](dns.hexEncodeName('test.mxc'), [textData, addrData])
        const [textRet] = publicResolver.interface.decodeFunctionResult(
          'text(bytes32,string)',
          textEncoded,
        )
        const [addrRet] = publicResolver.interface.decodeFunctionResult(
          'addr(bytes32)',
          addrEncoded,
        )
        expect(textRet).to.equal('bar')
        expect(addrRet).to.equal(accounts[1])
      })
      it('should resolve multiple records offchain', async () => {
        const textData = publicResolver.interface.encodeFunctionData(
          'text(bytes32,string)',
          [namehash.hash('offchain.test.mxc'), 'foo'],
        )
        const addrData = publicResolver.interface.encodeFunctionData(
          'addr(bytes32)',
          [namehash.hash('offchain.test.mxc')],
        )
        const callData = batchGateway.encodeFunctionData('query', [
          [
            [dummyOffchainResolver.address, ['https://example.com/'], textData],
            [dummyOffchainResolver.address, ['https://example.com/'], addrData],
          ],
        ])
        const extraData = ethers.utils.defaultAbiCoder.encode(
          ['bool', 'address', 'string[]', 'bytes', '(bytes4,bytes)[]'],
          [
            false,
            dummyOffchainResolver.address,
            ['http://universal-offchain-resolver.local/'],
            '0x',
            [
              [resolveCallbackSig, textData],
              [resolveCallbackSig, addrData],
            ],
          ],
        )
        try {
          await universalResolver['resolve(bytes,bytes[])'](
            dns.hexEncodeName('offchain.test.mxc'),
            [textData, addrData],
          )
        } catch (e) {
          expect(e.errorName).to.equal('OffchainLookup')
          expect(e.errorArgs.callData).to.equal(callData)
          expect(e.errorArgs.callbackFunction).to.equal(resolveCallbackSig)
          expect(e.errorArgs.extraData).to.equal(extraData)
        }
      })
    })
  })

  describe('resolveSingleCallback', () => {
    it('should resolve a record via a callback from offchain lookup', async () => {
      const addrData = publicResolver.interface.encodeFunctionData(
        'addr(bytes32)',
        [namehash.hash('offchain.test.mxc')],
      )
      const extraData = ethers.utils.defaultAbiCoder.encode(
        ['bool', 'address', 'string[]', 'bytes', '(bytes4,bytes)[]'],
        [
          false,
          dummyOffchainResolver.address,
          ['http://universal-offchain-resolver.local/'],
          '0x',
          [[resolveCallbackSig, addrData]],
        ],
      )
      const responses = batchGateway.encodeFunctionResult('query', [
        [false],
        [addrData],
      ])

      const [encodedAddr, resolverAddress] =
        await universalResolver.callStatic.resolveSingleCallback(
          responses,
          extraData,
        )
      expect(resolverAddress).to.equal(dummyOffchainResolver.address)
      const [addrRet] = publicResolver.interface.decodeFunctionResult(
        'addr(bytes32)',
        encodedAddr,
      )
      expect(addrRet).to.equal(dummyOffchainResolver.address)
    })
  })
  describe('resolveCallback', () => {
    it('should resolve records via a callback from offchain lookup', async () => {
      const addrData = publicResolver.interface.encodeFunctionData(
        'addr(bytes32)',
        [namehash.hash('offchain.test.mxc')],
      )
      const textData = publicResolver.interface.encodeFunctionData(
        'text(bytes32,string)',
        [namehash.hash('offchain.test.mxc'), 'foo'],
      )
      const extraData = ethers.utils.defaultAbiCoder.encode(
        ['bool', 'address', 'string[]', 'bytes', '(bytes4,bytes)[]'],
        [
          false,
          dummyOffchainResolver.address,
          ['http://universal-offchain-resolver.local/'],
          '0x',
          [
            [resolveCallbackSig, addrData],
            [resolveCallbackSig, textData],
          ],
        ],
      )
      const responses = batchGateway.encodeFunctionResult('query', [
        [false, false],
        [addrData, textData],
      ])
      const [[encodedRes, encodedResTwo], resolverAddress] =
        await universalResolver.callStatic.resolveCallback(responses, extraData)
      expect(resolverAddress).to.equal(dummyOffchainResolver.address)
      const [addrRet] = publicResolver.interface.decodeFunctionResult(
        'addr(bytes32)',
        encodedRes,
      )
      const [addrRetTwo] = publicResolver.interface.decodeFunctionResult(
        'addr(bytes32)',
        encodedResTwo,
      )
      expect(addrRet).to.equal(dummyOffchainResolver.address)
      expect(addrRetTwo).to.equal(dummyOffchainResolver.address)
    })
    it('should not revert if there is an error in a call', async () => {
      const extraData = ethers.utils.defaultAbiCoder.encode(
        ['bool', 'address', 'string[]', 'bytes', '(bytes4,bytes)[]'],
        [
          false,
          dummyOffchainResolver.address,
          ['http://universal-offchain-resolver.local/'],
          '0x',
          [[resolveCallbackSig, '0x']],
        ],
      )
      const responses = batchGateway.encodeFunctionResult('query', [
        [true],
        ['0x'],
      ])
      const [[encodedRes], resolverAddress] =
        await universalResolver.callStatic.resolveCallback(responses, extraData)
      expect(resolverAddress).to.equal(dummyOffchainResolver.address)
      expect(encodedRes).to.equal('0x')
    })
    it('should allow response at non-0 extraData index', async () => {
      const addrData = publicResolver.interface.encodeFunctionData(
        'addr(bytes32)',
        [namehash.hash('offchain.test.mxc')],
      )
      const textData = publicResolver.interface.encodeFunctionData(
        'text(bytes32,string)',
        [namehash.hash('offchain.test.mxc'), 'foo'],
      )
      const extraData = ethers.utils.defaultAbiCoder.encode(
        ['bool', 'address', 'string[]', 'bytes', '(bytes4,bytes)[]'],
        [
          false,
          dummyOffchainResolver.address,
          ['http://universal-offchain-resolver.local/'],
          '0x',
          [
            ['0x00000000', addrData],
            [resolveCallbackSig, textData],
          ],
        ],
      )
      const responses = batchGateway.encodeFunctionResult('query', [
        [false],
        [textData],
      ])
      const [[encodedRes, encodedResTwo], resolverAddress] =
        await universalResolver.callStatic.resolveCallback(responses, extraData)
      const [addrRet] = ethers.utils.defaultAbiCoder.decode(
        ['bytes'],
        encodedRes,
      )
      const [addrRetTwo] = publicResolver.interface.decodeFunctionResult(
        'addr(bytes32)',
        encodedResTwo,
      )
      expect(ethers.utils.toUtf8String(addrRet)).to.equal('onchain')
      expect(addrRetTwo).to.equal(dummyOffchainResolver.address)
      expect(resolverAddress).to.equal(dummyOffchainResolver.address)
    })
    it('should gracefully handle a non-existent function on an offchain resolver', async () => {
      const addrData = publicResolver.interface.encodeFunctionData(
        'addr(bytes32,uint256)',
        [namehash.hash('offchain.test.mxc'), 60],
      )
      const textData = publicResolver.interface.encodeFunctionData(
        'text(bytes32,string)',
        [namehash.hash('offchain.test.mxc'), 'foo'],
      )
      const extraData = ethers.utils.defaultAbiCoder.encode(
        ['bool', 'address', 'string[]', 'bytes', '(bytes4,bytes)[]'],
        [
          false,
          dummyOffchainResolver.address,
          ['http://universal-offchain-resolver.local/'],
          '0x',
          [
            ['0x00000000', addrData],
            [resolveCallbackSig, textData],
          ],
        ],
      )
      const responses = batchGateway.encodeFunctionResult('query', [
        [false],
        [textData],
      ])
      const [[addr, text], resolver] =
        await universalResolver.callStatic.resolveCallback(responses, extraData)
      const [addrRetFromText] = publicResolver.interface.decodeFunctionResult(
        'addr(bytes32)',
        text,
      )
      expect(addr).to.equal('0x')
      expect(addrRetFromText).to.equal(dummyOffchainResolver.address)
      expect(resolver).to.equal(dummyOffchainResolver.address)
    })
  })
  describe('reverseCallback', () => {
    it('should revert with metadata for initial forward resolution if required', async () => {
      const extraData = ethers.utils.defaultAbiCoder.encode(
        ['bool', 'address', 'string[]', 'bytes', '(bytes4,bytes)[]'],
        [
          false,
          dummyOffchainResolver.address,
          ['http://universal-offchain-resolver.local/'],
          '0x',
          [[resolveCallbackSig, '0x691f3431']],
        ],
      )
      const responses = batchGateway.encodeFunctionResult('query', [
        [false],
        ['0x691f3431'],
      ])
      try {
        await universalResolver.callStatic.reverseCallback(responses, extraData)
      } catch (e) {
        expect(e.errorName).to.equal('OffchainLookup')
        const extraDataReturned = ethers.utils.defaultAbiCoder.decode(
          ['bool', 'address', 'string[]', 'bytes', '(bytes4,bytes)[]'],
          e.errorArgs.extraData,
        )
        const metaData = ethers.utils.defaultAbiCoder.decode(
          ['string', 'address'],
          extraDataReturned[3],
        )
        expect(metaData[0]).to.equal('offchain.test.mxc')
        expect(metaData[1]).to.equal(dummyOffchainResolver.address)
      }
    })
    it('should resolve address record via a callback from offchain lookup', async () => {
      const metaData = ethers.utils.defaultAbiCoder.encode(
        ['string', 'address'],
        ['offchain.test.mxc', dummyOffchainResolver.address],
      )
      const extraData = ethers.utils.defaultAbiCoder.encode(
        ['bool', 'address', 'string[]', 'bytes', '(bytes4,bytes)[]'],
        [
          false,
          dummyOffchainResolver.address,
          ['http://universal-offchain-resolver.local/'],
          metaData,
          [[resolveCallbackSig, '0x']],
        ],
      )
      const responses = batchGateway.encodeFunctionResult('query', [
        [false],
        ['0x'],
      ])
      const [name, a1, a2, a3] = await universalResolver.reverseCallback(
        responses,
        extraData,
      )
      expect(name).to.equal('offchain.test.mxc')
      expect(a1).to.equal(dummyOffchainResolver.address)
      expect(a2).to.equal(dummyOffchainResolver.address)
      expect(a3).to.equal(dummyOffchainResolver.address)
    })
  })

  describe('reverse()', () => {
    const makeEstimateAndResult = async (contract, func, ...args) => ({
      estimate: await contract.estimateGas[func](...args),
      result: await contract.functions[func](...args),
    })
    it('should resolve a reverse record with name and resolver address', async () => {
      const { estimate, result } = await makeEstimateAndResult(
        universalResolver,
        'reverse(bytes)',
        dns.hexEncodeName(reverseNode),
      )
      console.log('GAS ESTIMATE:', estimate)
      expect(result['0']).to.equal('test.mxc')
      expect(result['1']).to.equal(accounts[1])
      expect(result['2']).to.equal(publicResolver.address)
      expect(result['3']).to.equal(publicResolver.address)
    })
    it('should not use all the gas on a revert', async () => {
      const estimate = await universalResolver.estimateGas['reverse(bytes)'](
        dns.hexEncodeName(oldResolverReverseNode),
        { gasLimit: 8000000 },
      )
      expect(estimate.lt(200000)).to.be.true
    })
  })
})

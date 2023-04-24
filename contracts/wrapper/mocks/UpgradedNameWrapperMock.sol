//SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;
import {INameWrapperUpgrade} from "../INameWrapperUpgrade.sol";
import "../../registry/ENS.sol";
import "../../ethregistrar/IBaseRegistrar.sol";
import {BytesUtils} from "../BytesUtils.sol";

contract UpgradedNameWrapperMock is INameWrapperUpgrade {
    using BytesUtils for bytes;

    bytes32 private constant ETH_NODE =
        0xc0ae3fe48f09fde4a60d1b2e3f2c5d1f8dd5922c3ab88ca76377c5fd10816e49;

    ENS public immutable ens;
    IBaseRegistrar public immutable registrar;

    constructor(ENS _ens, IBaseRegistrar _registrar) {
        ens = _ens;
        registrar = _registrar;
    }

    event NameUpgraded(
        bytes name,
        address wrappedOwner,
        uint32 fuses,
        uint64 expiry,
        address approved,
        bytes extraData
    );

    function wrapFromUpgrade(
        bytes calldata name,
        address wrappedOwner,
        uint32 fuses,
        uint64 expiry,
        address approved,
        bytes calldata extraData
    ) public {
        (bytes32 labelhash, uint256 offset) = name.readLabel(0);
        bytes32 parentNode = name.namehash(offset);
        bytes32 node = _makeNode(parentNode, labelhash);

        if (parentNode == ETH_NODE) {
            address registrant = registrar.ownerOf(uint256(labelhash));
            require(
                msg.sender == registrant &&
                    registrar.isApprovedForAll(registrant, address(this)),
                "No approval for registrar"
            );
        } else {
            address owner = ens.owner(node);
            require(
                msg.sender == owner &&
                    ens.isApprovedForAll(owner, address(this)),
                "No approval for registry"
            );
        }
        emit NameUpgraded(
            name,
            wrappedOwner,
            fuses,
            expiry,
            approved,
            extraData
        );
    }

    function _makeNode(
        bytes32 node,
        bytes32 labelhash
    ) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(node, labelhash));
    }
}

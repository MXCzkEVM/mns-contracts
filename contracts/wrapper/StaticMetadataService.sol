//SPDX-License-Identifier: MIT
pragma solidity ~0.8.17;
import "@openzeppelin/contracts/utils/Strings.sol";

contract StaticMetadataService {
    using Strings for uint256;

    string private _uri;

    constructor(string memory _metaDataUri) {
        _uri = _metaDataUri;
    }

    function uri(uint256 tokenId) public view returns (string memory) {
        return
            bytes(_uri).length > 0
                ? string(abi.encodePacked(_uri, tokenId.toString()))
                : "";
    }
}

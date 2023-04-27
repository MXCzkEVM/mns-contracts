pragma solidity >=0.8.4;

import {Controllable} from "../root/Controllable.sol";

contract DummyOracle is Controllable {
    int256 value;

    constructor(int256 _value) public {
        value = _value;
    }

    function set(int256 _value) public onlyController {
        value = _value;
    }

    function latestAnswer() public view returns (int256) {
        return value;
    }
}

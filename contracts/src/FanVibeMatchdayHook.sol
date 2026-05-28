// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @notice Experimental Uniswap v4 hook for FanVibe's WOKB/USDT X Layer pool.
/// @dev This hook is intentionally isolated from FanVibe staking, settlement, and payouts.
contract FanVibeMatchdayHook is Ownable {
  using PoolIdLibrary for PoolKey;

  address public immutable poolManager;

  enum MatchPhase {
    Preseason,
    MatchOpen,
    Live,
    Settled
  }

  address public constant WOKB = 0xe538905cf8410324e03A5A23C1c177a474D59b2b;
  address public constant USDT = 0x1E4a5963aBFD975d8c9021ce480b42188849D41d;

  uint24 public constant DEFAULT_NORMAL_FEE = 500; // 0.05%
  uint24 public constant DEFAULT_LIVE_FEE = 3000; // 0.30%
  uint24 public constant DEFAULT_SETTLED_FEE = 1000; // 0.10%

  MatchPhase public phase = MatchPhase.Preseason;
  uint24 public normalFee = DEFAULT_NORMAL_FEE;
  uint24 public liveFee = DEFAULT_LIVE_FEE;
  uint24 public settledFee = DEFAULT_SETTLED_FEE;

  mapping(PoolId => bool) public approvedPool;

  event MatchPhaseUpdated(MatchPhase indexed phase, string fixtureId);
  event PoolApprovalUpdated(PoolId indexed poolId, bool approved);
  event MatchdayFeeApplied(PoolId indexed poolId, address indexed sender, MatchPhase indexed phase, uint24 fee);
  event HookFeesUpdated(uint24 normalFee, uint24 liveFee, uint24 settledFee);

  error UnsupportedPool();
  error InvalidFee();
  error NotPoolManager();

  constructor(address manager, address initialOwner) Ownable(initialOwner) {
    poolManager = manager;
  }

  function approvePool(PoolKey calldata key, bool approved) external onlyOwner {
    if (!_isWokbUsdtPool(key)) revert UnsupportedPool();
    PoolId poolId = key.toId();
    approvedPool[poolId] = approved;
    emit PoolApprovalUpdated(poolId, approved);
  }

  function setMatchPhase(MatchPhase nextPhase, string calldata fixtureId) external onlyOwner {
    phase = nextPhase;
    emit MatchPhaseUpdated(nextPhase, fixtureId);
  }

  function setFees(uint24 nextNormalFee, uint24 nextLiveFee, uint24 nextSettledFee) external onlyOwner {
    if (
      !LPFeeLibrary.isValid(nextNormalFee)
        || !LPFeeLibrary.isValid(nextLiveFee)
        || !LPFeeLibrary.isValid(nextSettledFee)
    ) revert InvalidFee();

    normalFee = nextNormalFee;
    liveFee = nextLiveFee;
    settledFee = nextSettledFee;
    emit HookFeesUpdated(nextNormalFee, nextLiveFee, nextSettledFee);
  }

  function currentFee() public view returns (uint24) {
    if (phase == MatchPhase.Live) return liveFee;
    if (phase == MatchPhase.Settled) return settledFee;
    return normalFee;
  }

  function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata, bytes calldata)
    external
    returns (bytes4, BeforeSwapDelta, uint24)
  {
    if (msg.sender != poolManager) revert NotPoolManager();
    if (!_isWokbUsdtPool(key)) revert UnsupportedPool();

    PoolId poolId = key.toId();
    if (!approvedPool[poolId]) revert UnsupportedPool();

    uint24 fee = currentFee();
    emit MatchdayFeeApplied(poolId, sender, phase, fee);
    return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
  }

  function _isWokbUsdtPool(PoolKey calldata key) private pure returns (bool) {
    address currency0 = Currency.unwrap(key.currency0);
    address currency1 = Currency.unwrap(key.currency1);
    return (currency0 == WOKB && currency1 == USDT) || (currency0 == USDT && currency1 == WOKB);
  }
}

import { useAccount, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { DueLinkCoreAbi, DUELINK_CORE_ADDRESS, IS_CONTRACT_DEPLOYED, USDC_ADDRESS, MINIMAL_ERC20_ABI } from "../config/contracts";

const core = { address: DUELINK_CORE_ADDRESS, abi: DueLinkCoreAbi } as const;
const usdc = { address: USDC_ADDRESS, abi: MINIMAL_ERC20_ABI } as const;

/** True USDC ERC-20 balance for the connected wallet (6 decimals). */
export function useUsdcBalance() {
  const { address } = useAccount();
  return useReadContract({
    ...usdc,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });
}

export function useUsdcAllowance() {
  const { address } = useAccount();
  return useReadContract({
    ...usdc,
    functionName: "allowance",
    args: address ? [address, DUELINK_CORE_ADDRESS] : undefined,
    query: { enabled: Boolean(address) && IS_CONTRACT_DEPLOYED },
  });
}

export function useApproveUsdc() {
  const { writeContractAsync, isPending } = useWriteContract();
  const approve = async (amount: bigint) =>
    writeContractAsync({ ...usdc, functionName: "approve", args: [DUELINK_CORE_ADDRESS, amount] });
  return { approve, isPending };
}

/** All link ids touching this address (as initiator or counterparty). */
export function useUserLinkIds() {
  const { address } = useAccount();
  return useReadContract({
    ...core,
    functionName: "getLinksByUser",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) && IS_CONTRACT_DEPLOYED },
  });
}

/** Batched read of full Link structs for a list of ids (multicall). */
export function useLinks(ids: readonly bigint[] | undefined) {
  return useReadContracts({
    contracts: (ids ?? []).map((id) => ({ ...core, functionName: "getLink", args: [id] }) as const),
    query: { enabled: Boolean(ids && ids.length > 0) && IS_CONTRACT_DEPLOYED },
  });
}

export function useLink(id: bigint | undefined) {
  return useReadContract({
    ...core,
    functionName: "getLink",
    args: id !== undefined ? [id] : undefined,
    query: { enabled: id !== undefined && IS_CONTRACT_DEPLOYED },
  });
}

export function useLoanTerms(id: bigint | undefined) {
  return useReadContract({
    ...core,
    functionName: "getLoanTerms",
    args: id !== undefined ? [id] : undefined,
    query: { enabled: id !== undefined && IS_CONTRACT_DEPLOYED },
  });
}

export function useEscrowTerms(id: bigint | undefined) {
  return useReadContract({
    ...core,
    functionName: "getEscrowTerms",
    args: id !== undefined ? [id] : undefined,
    query: { enabled: id !== undefined && IS_CONTRACT_DEPLOYED },
  });
}

export function useInvoiceTerms(id: bigint | undefined) {
  return useReadContract({
    ...core,
    functionName: "getInvoiceTerms",
    args: id !== undefined ? [id] : undefined,
    query: { enabled: id !== undefined && IS_CONTRACT_DEPLOYED },
  });
}

export function useLoanTotalOwed(id: bigint | undefined) {
  return useReadContract({
    ...core,
    functionName: "getLoanTotalOwed",
    args: id !== undefined ? [id] : undefined,
    query: { enabled: id !== undefined && IS_CONTRACT_DEPLOYED },
  });
}

export function useReputation(address: `0x${string}` | undefined) {
  const registry = useReadContract({ ...core, functionName: "reputation", query: { enabled: IS_CONTRACT_DEPLOYED } });
  const rate = useReadContract({
    address: registry.data as `0x${string}` | undefined,
    abi: [
      {
        type: "function",
        name: "fulfillmentRateBps",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
      },
    ] as const,
    functionName: "fulfillmentRateBps",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(registry.data) && Boolean(address) },
  });
  return rate;
}

/** All Link write actions in one place, sharing the same writeContractAsync instance. */
export function useDueLinkActions() {
  const { writeContractAsync, isPending } = useWriteContract();

  const call = (functionName: string, args: readonly unknown[]) =>
    writeContractAsync({ ...core, functionName, args } as never);

  return {
    isPending,
    // Send
    createSendLink: (counterparty: `0x${string}`, amount: bigint, expiresAt: bigint, termsHash: `0x${string}`) =>
      call("createSendLink", [counterparty, amount, expiresAt, termsHash]),
    acceptSendLink: (id: bigint) => call("acceptSendLink", [id]),
    cancelSendLink: (id: bigint) => call("cancelSendLink", [id]),
    // Loan
    createLoanLink: (
      borrower: `0x${string}`,
      principal: bigint,
      interestBps: number,
      dueDate: bigint,
      installments: number,
      collateralToken: `0x${string}`,
      collateralAmount: bigint,
      termsHash: `0x${string}`,
    ) =>
      call("createLoanLink", [
        borrower,
        principal,
        interestBps,
        dueDate,
        installments,
        collateralToken,
        collateralAmount,
        termsHash,
      ]),
    acceptLoanLink: (id: bigint) => call("acceptLoanLink", [id]),
    repayLoan: (id: bigint, amount: bigint) => call("repayLoan", [id, amount]),
    checkLoanDefault: (id: bigint) => call("checkLoanDefault", [id]),
    cancelLoanLink: (id: bigint) => call("cancelLoanLink", [id]),
    // Escrow
    createEscrowLink: (
      seller: `0x${string}`,
      amount: bigint,
      releaseMode: number,
      autoReleaseAt: bigint,
      arbitrator: `0x${string}`,
      deliverableHash: `0x${string}`,
      termsHash: `0x${string}`,
    ) => call("createEscrowLink", [seller, amount, releaseMode, autoReleaseAt, arbitrator, deliverableHash, termsHash]),
    acceptEscrowLink: (id: bigint) => call("acceptEscrowLink", [id]),
    confirmDelivery: (id: bigint) => call("confirmDelivery", [id]),
    autoRelease: (id: bigint) => call("autoRelease", [id]),
    raiseDispute: (id: bigint) => call("raiseDispute", [id]),
    resolveDispute: (id: bigint, releaseToSeller: boolean) => call("resolveDispute", [id, releaseToSeller]),
    cancelEscrowLink: (id: bigint) => call("cancelEscrowLink", [id]),
    // Invoice
    createInvoiceLink: (
      payer: `0x${string}`,
      amount: bigint,
      dueDate: bigint,
      lateFeeBps: number,
      recurring: boolean,
      cycleSeconds: bigint,
      termsHash: `0x${string}`,
    ) => call("createInvoiceLink", [payer, amount, dueDate, lateFeeBps, recurring, cycleSeconds, termsHash]),
    acceptInvoiceLink: (id: bigint) => call("acceptInvoiceLink", [id]),
    payInvoice: (id: bigint, amount: bigint) => call("payInvoice", [id, amount]),
    checkOverdue: (id: bigint) => call("checkOverdue", [id]),
    cancelInvoiceLink: (id: bigint) => call("cancelInvoiceLink", [id]),
  };
}

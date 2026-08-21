import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Label for the basis a return is quoted on. The backend only annualizes TWR
 * and MWR once the window spans at least a year (`PerformanceMetrics.annualized`);
 * shorter windows carry the plain period return, and calling that "Ann." is
 * how a 2% week ended up displayed as +180% (issue #256).
 */
export function returnBasis(annualized?: boolean | null): string {
  return annualized ? "Ann." : "Period";
}

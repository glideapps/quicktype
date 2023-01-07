export type SignupEncouragementStrategy = "none" | "after 10 copies" | "limit options";

export function getSignupEncouragementStrategy(): SignupEncouragementStrategy {
  return "none";
}

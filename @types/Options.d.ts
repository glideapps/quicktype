import { Maybe } from "./Data.Maybe";

export interface BooleanValue {
  value0: boolean;
}

export interface StringValue {
  value0: string;
}

export interface EnumValue {
  value0: number;
  value1: string[];
}

export type OptionValue = BooleanValue | StringValue | EnumValue;

export interface OptionSpecification {
  name: string;
  description: string;
  typeLabel: string;
  default: OptionValue;
}

export const valueType: (
  value: OptionValue
) => "BooleanValue" | "StringValue" | "EnumValue";

export const stringValue: (value: OptionValue) => Maybe<string>;

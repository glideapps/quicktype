import { InferenceFlags } from "quicktype-core";

import { SourcePadState, LayoutState, UserState, LanguageOptions } from "./types";

export enum ActionType {
  SetLanguage = "SET_LANGUAGE",
  SetLanguageOption = "SET_LANGUAGE_OPTION",
  SetInferenceFlags = "SET_INFERENCE_OPTION",
  SetSourceNodeExpanded = "SET_SOURCE_NODE_EXPANDED",
  SetSourceNodeSelected = "SET_SOURCE_NODE_SELECTED",
  SetSourceState = "SET_SOURCE_STATE",
  SetUserState = "SET_USER_STATE",
  SetLayout = "SET_LAYOUT",
  IncrementCopies = "INCREMENT_COPIES"
}

export function setLanguage(language: string) {
  return { type: ActionType.SetLanguage, payload: language };
}

export function setLanguageOptions(language: string, options: Partial<LanguageOptions>) {
  return { type: ActionType.SetLanguageOption, payload: options };
}

export function setInferenceFlags(flags: Partial<InferenceFlags>) {
  return { type: ActionType.SetInferenceFlags, payload: flags };
}

export type SetSourceNodeExpandedPayload = { id: number; expanded: boolean };

export function setSourceNodeExpanded(id: number, expanded: boolean = true) {
  return {
    type: ActionType.SetSourceNodeExpanded,
    payload: { id, expanded } as SetSourceNodeExpandedPayload
  };
}

export type SetSourceStatePayload = Partial<SourcePadState>;

export function setSourceState(state: Partial<SourcePadState>) {
  return { type: ActionType.SetSourceState, payload: state };
}

export type SetUserStatePayload = Partial<UserState>;

export function setUserState(state: SetUserStatePayload) {
  return { type: ActionType.SetUserState, payload: state };
}

export function incrementCopies() {
  return { type: ActionType.IncrementCopies };
}

export type SetLayoutPayload = Partial<LayoutState>;

export function setLayout(state: Partial<LayoutState>) {
  return { type: ActionType.SetLayout, payload: state };
}

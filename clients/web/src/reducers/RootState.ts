import { Reducer, combineReducers } from "redux";
import { RootState } from "../types";

import userState from "./UserState";
import optionsPad from "./OptionsPadState";
import sourcePad from "./SourcePadState";
import layout from "./LayoutState";

export const rootState: Reducer<RootState> = combineReducers({
  userState,
  optionsPad,
  sourcePad,
  layout
});

export const defaultState = rootState(undefined as any, { type: "" });

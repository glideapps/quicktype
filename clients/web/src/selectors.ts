import { RootState, UserState } from "./types";
import { createSelector } from "reselect";
import { SourceType } from "./quicktype";

export const displayOptions = createSelector<RootState, boolean, boolean>(state => state.layout.displayOptions, x => x);
export const userState = createSelector<RootState, UserState, UserState>(state => state.userState, x => x);
export const language = createSelector<RootState, string, string>(state => state.optionsPad.language, x => x);
export const sourceType = createSelector<RootState, SourceType, SourceType>(
  state => state.sourcePad.sourceType,
  x => x
);

import { RootState } from "./types";
import { createSelector } from "reselect";

export const displayOptions = createSelector(
    (state: RootState) => state.layout.displayOptions,
    x => x
);
export const userState = createSelector(
    (state: RootState) => state.userState,
    x => x
);
export const language = createSelector(
    (state: RootState) => state.optionsPad.language,
    x => x
);
export const sourceType = createSelector(
    (state: RootState) => state.sourcePad.sourceType,
    x => x
);

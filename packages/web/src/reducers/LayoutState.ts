import { AnyAction } from "redux";

import { LayoutState } from "../types";
import { ActionType, SetLayoutPayload } from "../actions";
import { defaults } from "lodash";

const defaultState: LayoutState = {
    displayOptions: true
};

export default function layout(state: LayoutState = defaultState, action: AnyAction) {
    switch (action.type) {
        case ActionType.SetLayout:
            const newLayout: SetLayoutPayload = action.payload;
            return defaults(newLayout, state);
        default:
            return state;
    }
}

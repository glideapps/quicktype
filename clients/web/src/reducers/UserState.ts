import { AnyAction } from "redux";

import { UserState } from "../types";
import { ActionType, SetUserStatePayload } from "../actions";

const defaultState: UserState = {
    visits: 0,
    copies: 0
};

export default function userState(state: UserState = defaultState, action: AnyAction) {
    switch (action.type) {
        case ActionType.SetUserState:
            const newState: SetUserStatePayload = action.payload;
            return Object.assign({}, state, newState);
        case ActionType.IncrementCopies:
            return {
                ...state,
                copies: state.copies + 1
            };
        default:
            return state;
    }
}

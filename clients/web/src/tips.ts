import Toaster from "./components/Toaster";
import { IToastProps, Intent } from "@blueprintjs/core";
import { RootState } from "./types";

// import { mobile } from "bowser";
const mobile = false;

type Tip = IToastProps & {
    shouldShow?: (state: RootState) => boolean;
};

const TIP_DELAY = 4 * 1000;

const tips: { [key: number]: Tip } = {
    0: {
        message: "quicktype is designed for larger screens",
        intent: Intent.WARNING,
        timeout: 30000,
        icon: "warning-sign",
        shouldShow() {
            return mobile;
        }
    }
};

export function sendTips(state: RootState) {
    const tip = tips[state.userState.visits];
    if (tip !== undefined) {
        if (tip.shouldShow === undefined || tip.shouldShow(state)) {
            setTimeout(() => Toaster.show(tip), TIP_DELAY);
        }
    }
}

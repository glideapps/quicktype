import * as _ from "lodash";
import { TargetLanguage } from "quicktype-core";

export function sendEvent(category: string, action: string, label?: string, value?: number) {
  ga("send", "event", category, action, label, value);
}

export function sendUserLanguage(language: TargetLanguage | string) {
  const displayName = language instanceof TargetLanguage ? language.displayName : language;
  ga("set", "dimension1", displayName);
}

export function setLoggedIn(loggedIn: boolean) {
  ga("set", "dimension2", loggedIn.toString());
}

export const sendEventDebounced = _.debounce(sendEvent, 1000);

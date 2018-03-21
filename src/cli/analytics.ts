import * as ga from "universal-analytics";
import * as storage from "./storage";

const uuid = require("uuid/v4");

const GoogleAnalyticsID = "UA-102732788-5";

export interface Analytics {
    pageview(page: string): void;
    timing(category: string, variable: string, time: number): void;
    event(category: string, action: string, label?: string, value?: string | number): void;
}

export class NoAnalytics implements Analytics {
    pageview(_page: string): void {
        // Pass
    }

    timing(_category: string, _variable: string, _time: number): void {
        // Pass
    }

    event(_category: string, _action: string, _label?: string, _value?: string | number): void {
        // Pass
    }
}

export class GoogleAnalytics implements Analytics {
    private readonly visitor: ga.Visitor;

    constructor() {
        const userId = storage.get("userId", uuid());
        this.visitor = ga(GoogleAnalyticsID, userId);
    }

    pageview(page: string): void {
        this.visitor.pageview(page).send();
    }

    timing(category: string, variable: string, time: number): void {
        this.visitor.timing(category, variable, time).send();
    }

    event(category: string, action: string, label?: string, value?: string | number): void {
        if (label !== undefined) {
            if (value !== undefined) {
                this.visitor.event(category, action, label, value).send();
            } else {
                this.visitor.event(category, action, label).send();
            }
        } else {
            this.visitor.event(category, action).send();
        }
    }
}
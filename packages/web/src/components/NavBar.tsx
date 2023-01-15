import "../styles/NavBar.css";

import * as React from "react";
import { connect } from "react-redux";

import { Button, Popover, MenuItem, Menu, Position, MenuDivider } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";

import * as analytics from "../analytics";
import { RootState } from "../types";
import { setLayout } from "../actions";
import * as selector from "../selectors";
import { composeTweet } from "../twitter";

enum Hyperlink {
    GitHub = "https://github.com/quicktype/quicktype",
    VSCodeExtension = "https://marketplace.visualstudio.com/items?itemName=quicktype.quicktype",
    VSExtension = "https://marketplace.visualstudio.com/items?itemName=typeguard.quicktype-vs",
    XCodeExtension = "https://itunes.apple.com/us/app/paste-json-as-code-quicktype/id1330801220?mt=12",
    Twitter = "https://twitter.com/quicktypeio",
    Blog = "http://blog.quicktype.io",
    Home = "https://quicktype.io",
    FAQ = "https://github.com/quicktype/quicktype/blob/master/FAQ.md",
    GitHubNewIssue = "https://github.com/quicktype/quicktype/issues/new",
    GlideJobs = "https://www.glideapps.com/jobs?quicktype",
    Sponsor = "https://github.com/sponsors/quicktype",
    CLI = "https://github.com/quicktype/quicktype#installation"
}

function sendEvent(action: string, label?: string) {
    analytics.sendEvent("NavBar", action, label);
}

function openLink(link: Hyperlink, target: "blank" | "self" = "blank") {
    sendEvent("open link", link);
    window.open(link, "_" + target);
}

type OptionsToggleProps = {
    displayOptions: boolean;
    setDisplayOptions(displayOptions: boolean): void;
};

const OptionsToggle = ({ displayOptions, setDisplayOptions }: OptionsToggleProps) => (
    <Button
        className={`bp3-minimal`}
        icon={displayOptions ? IconNames.EYE_OPEN : IconNames.EYE_OFF}
        tabIndex={0}
        onClick={() => {
            sendEvent(`options`, !displayOptions ? "on" : "off");
            setDisplayOptions(!displayOptions);
        }}
    >
        Options
    </Button>
);

const ConnectedOptionsToggle = connect(
    (state: RootState) => ({
        displayOptions: selector.displayOptions(state)
    }),
    dispatch => ({
        setDisplayOptions(displayOptions: boolean) {
            dispatch(setLayout({ displayOptions }));
        }
    })
)(OptionsToggle);

type NavBarProps = { language: string; output: string | undefined };

const NavBar = ({ language, output }: NavBarProps) => (
    <nav className="nav bp3-navbar bp3-dark">
        <div className="bp3-navbar-group bp3-align-left">
            <div className="bp3-navbar-heading">
                <a href="#" onClick={() => openLink(Hyperlink.Home, "self")}>
                    <img src="logo-small.svg" />
                </a>
            </div>
        </div>
        {embedded ? null : (
            <div className="bp3-navbar-group bp3-align-right">
                <Button
                    icon="heart"
                    minimal={true}
                    className="no-mobile"
                    onClick={() => openLink(Hyperlink.Sponsor, "blank")}
                >
                    Sponsor us!
                </Button>
                <Button
                    icon="chat"
                    minimal={true}
                    className="no-mobile"
                    onClick={() => {
                        composeTweet(output || "", language, "https://app.quicktype.io");
                    }}
                >
                    Share on Twitter
                </Button>
                <Button icon="git-branch" minimal={true} onClick={() => openLink(Hyperlink.GitHub, "blank")}>
                    Open on GitHub
                </Button>
                <ConnectedOptionsToggle />
            </div>
        )}
    </nav>
);

export default NavBar;

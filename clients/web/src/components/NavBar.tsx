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
    CLI = "https://github.com/quicktype/quicktype#installation"
}

function sendEvent(action: string, label?: string) {
    analytics.sendEvent("NavBar", action, label);
}

function openLink(link: Hyperlink, target: "blank" | "self" = "blank") {
    sendEvent("open link", link);
    window.open(link, "_" + target);
}

const OverflowMenu = ({}) => (
    <Popover
        popoverClassName="bp3-minimal"
        inheritDarkTheme={false}
        content={
            <Menu>
                <MenuItem
                    key="0"
                    onClick={() => openLink(Hyperlink.GitHub)}
                    icon={IconNames.GIT_BRANCH}
                    text="View on GitHub"
                />
                <MenuDivider />
                <MenuItem
                    key="8"
                    disabled={true}
                    text={`v${process.env.REACT_APP_QUICKTYPE_CORE} (${(process.env.REACT_APP_GIT_COMMIT || "").substr(
                        0,
                        6
                    )})`}
                />
            </Menu>
        }
        position={Position.BOTTOM_RIGHT}
    >
        <Button icon={IconNames.MORE} minimal={true} tabIndex={0} style={{ transform: "rotate(90deg)" }} />
    </Popover>
);

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
                    minimal={true}
                    className="no-mobile"
                    onClick={() => {
                        composeTweet(output || "", language, "https://app.quicktype.io");
                    }}
                >
                    🙏 Please Share!
                </Button>
                <ConnectedOptionsToggle />
                <Button icon="help" minimal={true} onClick={() => openLink(Hyperlink.FAQ, "blank")} />
                <OverflowMenu />
            </div>
        )}
    </nav>
);

export default NavBar;

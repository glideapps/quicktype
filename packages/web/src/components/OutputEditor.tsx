import AceEditor from "react-ace";
import { Intent, IToastProps } from "@blueprintjs/core";
import classNames from "classnames";

import "ace-builds/src-noconflict/theme-chrome";
import "ace-builds/src-noconflict/theme-xcode";

import "ace-builds/src-noconflict/mode-csharp";
import "ace-builds/src-noconflict/mode-typescript";
import "ace-builds/src-noconflict/mode-javascript";
import "ace-builds/src-noconflict/mode-groovy";
import "ace-builds/src-noconflict/mode-elm";
import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/mode-swift";
import "ace-builds/src-noconflict/mode-java";
import "ace-builds/src-noconflict/mode-golang";
import "ace-builds/src-noconflict/mode-c_cpp";
import "ace-builds/src-noconflict/mode-objectivec";
import "ace-builds/src-noconflict/mode-rust";
import "ace-builds/src-noconflict/mode-ruby";
import "ace-builds/src-noconflict/mode-kotlin";
import "ace-builds/src-noconflict/mode-python";
import "ace-builds/src-noconflict/mode-dart";
import "ace-builds/src-noconflict/mode-haskell";

import * as React from "react";

import Toaster from "./Toaster";
import * as storage from "../storage";
// import * as twitter from "../twitter";
import * as signal from "../signals";

import * as analytics from "../analytics";

import "../styles/OutputEditor.css";
import { SourceType } from "../quicktype";
import { RootState } from "../types";
import { Store } from "redux";

function sendEvent(name: string, label?: string, value?: number) {
    analytics.sendEvent("OutputEditor", name, label, value);
}

interface OutputEditorProps {
    store: Store<RootState>;
    source?: string;
    sourceType: SourceType;
    language: string;
    rendering: boolean;
}

const languageMode: Record<string, string> = {
    "C#": "csharp",
    "Simple Types": "groovy",
    Elm: "elm",
    "JSON Schema": "json",
    Swift: "swift",
    TypeScript: "typescript",
    "JavaScript PropTypes": "javascript",
    Flow: "typescript",
    Java: "java",
    Go: "golang",
    Ruby: "ruby",
    Crystal: "ruby",
    "Kotlin (beta)": "kotlin",
    Python: "python",
    "Objective-C": "objectivec",
    "C++": "c_cpp",
    Dart: "dart",
    Rust: "rust"
};

const languageTheme: Record<string, string> = {
    Swift: "xcode",
    "Objective-C": "xcode",
    Rust: "xcode"
};

class OutputEditor extends React.Component<OutputEditorProps, {}> {
    lastTweetToast?: string;
    editor: any;

    componentDidMount() {
        signal.subscribe("CopyOutput", () => this.copyOutput());

        const getCopyText = this.editor.getCopyText.bind(this.editor);
        this.editor.getCopyText = () => {
            return getCopyText();
        };
    }

    get tweetOffered(): boolean {
        return storage.load("tweet offered", false, true) as boolean;
    }

    set tweetOffered(dismissed: boolean) {
        storage.save("tweet offered", dismissed);
    }

    render() {
        return (
            <div className={classNames("output", { blank: this.props.rendering })}>
                <AceEditor
                    ref={() => (this.editor = ace.edit("output"))}
                    mode={languageMode[this.props.language]}
                    theme={languageTheme[this.props.language] || "chrome"}
                    name="output"
                    showGutter={false}
                    fontSize={15}
                    showPrintMargin={false}
                    highlightActiveLine={false}
                    value={this.props.source}
                    readOnly={true}
                    onCopy={text => {
                        sendEvent("copy", this.props.sourceType);
                        // this.offerTweet(text);
                        this.showCopyConfirmationToast(text);
                    }}
                    editorProps={{ $blockScrolling: Infinity }}
                    setOptions={{ showPrintMargin: false, displayIndentGuides: false }}
                />
            </div>
        );
    }

    private showCopyConfirmationToast(source?: string) {
        const theSource = source || this.props.source || "";
        const lines = theSource.split("\n").length;
        Toaster.show({
            message: `Copied ${lines} lines of ${this.props.language}`,
            intent: Intent.SUCCESS,
            icon: "tick",
            timeout: 3500
        });
    }

    // private offerTweet(source?: string) {
    //   const theSource = source || this.props.source || "";
    //   if (!this.tweetOffered) {
    //     setTimeout(() => {
    //       this.tweetOffered = twitter.tryOfferTweet(theSource, this.props.language);
    //     }, 500);
    //   }
    // }

    private copyOutput = () => {
        let editor = ace.edit("output");
        let savedSelection = editor.selection.toJSON();

        editor.selectAll();
        editor.focus();
        const success = window.document.execCommand("copy");
        editor.blur();
        editor.selection.fromJSON(savedSelection);

        if (this.lastTweetToast) {
            Toaster.dismiss(this.lastTweetToast);
            this.lastTweetToast = undefined;
        }

        if (success) {
            // this.offerTweet();
        } else {
            const props: IToastProps = {
                message: `Couldn't copy ${this.props.language}, please select and copy manually.`,
                intent: Intent.DANGER,
                icon: "error"
            };
            Toaster.show(props);
        }
    };
}

export default OutputEditor;

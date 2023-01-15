import { FocusStyleManager, Intent, IToastProps, ProgressBar } from "@blueprintjs/core";
import classNames from "classnames";
import download from "downloadjs";
import { hashCode } from "hashcode";
import JSZip from "jszip";
import _, { debounce } from "lodash";
import { languageNamed, Options } from "quicktype-core";
import * as React from "react";
import { Store } from "redux";
import { setLayout, setSourceState, setUserState } from "../../actions";
import * as analytics from "../../analytics";
import { AsyncSerializedRenderResult, Files, SourceType } from "../../quicktype";
import * as samples from "../../samples";
import * as signal from "../../signals";
import { sendTips } from "../../tips";
import { RootState, SourcePadState, WorkerRenderMessage } from "../../types";
import { defined } from "../../util";
import NavBar from "../NavBar";
import OptionsPad from "../OptionsPad";
import OutputEditor from "../OutputEditor";
import SourcePad from "../SourcePad";
import Toaster from "../Toaster";
import GlideJobsBar from "../GlideJobsBar";
import "./App.css";

import "ace-builds/src-noconflict/ext-searchbox";

const showJobsAd = false;

// eslint-disable-next-line
const Worker = require("worker-loader?chunkFilename=static/js/worker.[hash:8].js!../../worker");

// If the state store starts changing faster than this, we debounce rendering
// This keeps rendering instantaneous for atomic state changes (changing a toggle)
// but throttles rendering if state is updating continuously (e.g. user is typing)
const minimumStoreUpdateInterval = 600;

interface AppState {
    output?: Files;
    rendering: boolean;
    dragEntered: boolean;
    dragging: boolean;
}

interface AppProps {
    store: Store<RootState>;
}

const PROGRESS_TOAST_WAIT = 700;
const PROGRESS_TOAST_MIN_DURATION = 1200;

function getValidFiles(ev: React.DragEvent<HTMLDivElement>): File[] {
    function isValidFile(name: string): boolean {
        return [".ts", ".json", ".schema"].some(ext => name.toLowerCase().endsWith(ext));
    }

    const { items, files } = ev.dataTransfer;
    if (items) {
        // Use DataTransferItemList interface to access the file(s)
        return _(items)
            .map(item => item.getAsFile())
            .filter(f => f !== null && isValidFile(f.name))
            .value() as File[];
    } else if (files) {
        // Use DataTransfer interface to access the file(s)
        return _(files)
            .filter(f => f !== null && isValidFile(f.name))
            .value();
    } else {
        return [];
    }
}

function sendEvent(name: string, label?: string, value?: number) {
    analytics.sendEvent("App", name, label, value);
}

class App extends React.Component<AppProps, AppState> {
    progressToast?: { id: string; time: Date };
    progressToastTimer?: any;
    dragEnterCount: number;
    asyncRenderErrorToastKey?: string;

    receipt: number = 0;
    lastStoreUpdate = Date.now();

    worker: {
        onmessage: (message: { data: AsyncSerializedRenderResult }) => void;
        postMessage: (message: WorkerRenderMessage) => void;
    };

    get storeState(): RootState {
        return this.props.store.getState();
    }

    get flattenedOutput(): string | undefined {
        const files = this.state.output;
        if (files === undefined) {
            return undefined;
        }
        switch (_.size(files)) {
            case 0:
                return undefined;
            case 1:
                return _.values(files)[0].lines.join("\n");
            default:
                return _.chain(files)
                    .flatMap((file, name) => [`// ${name}`, "", ...file.lines])
                    .value()
                    .join("\n");
        }
    }

    renderAsync = debounce(() => {
        const message = this.getWorkerRenderMessage();
        this.receipt = message.receipt;
        this.setState({ rendering: true });
        this.worker.postMessage(message);
        this.displayProgressToast("Analyzing sample data...");
    }, 10);

    renderAsyncDebounced = debounce(this.renderAsync, minimumStoreUpdateInterval);

    constructor(props: AppProps) {
        super(props);

        FocusStyleManager.onlyShowFocusOnTabs();

        this.props.store.subscribe(() => {
            this.forceUpdate();

            // We watch for all state changes, but only render if the receipt will change
            const { receipt } = this.getWorkerRenderMessage();
            if (receipt !== this.receipt) {
                const elapsedSinceLastStateChange = Date.now() - this.lastStoreUpdate;
                if (elapsedSinceLastStateChange < minimumStoreUpdateInterval) {
                    // Throttle rendering if state is changing continuously
                    this.renderAsyncDebounced();
                } else {
                    // Update instantly otherwise
                    // (We could throttle all rendering but this makes quicktype feel really snappy)
                    this.renderAsync();
                }
            }

            this.lastStoreUpdate = Date.now();
        });

        this.dragEnterCount = 0;
        this.state = { rendering: true, dragEntered: false, dragging: false };
        this.worker = new Worker();
        this.worker.onmessage = ({ data }) => this.onAsyncRenderResult(data);
    }

    componentDidMount() {
        const { store } = this.props;
        const { layout, userState, optionsPad } = store.getState();

        sendTips(store.getState());
        store.dispatch(
            setUserState({
                ...userState,
                visits: userState.visits + 1
            })
        );

        signal.subscribe("DownloadOutput", () => this.downloadSource());

        analytics.sendUserLanguage(optionsPad.language);

        window.addEventListener("resize", e => {
            if (window.innerWidth < 1100) {
                if (layout.displayOptions) {
                    store.dispatch(setLayout({ displayOptions: false }));
                }
            }
        });
    }

    render() {
        const output = this.flattenedOutput;

        return (
            <div
                className={classNames("app", {
                    dragging: this.state.dragging
                })}
                onDrop={this.drop}
                onDragEnter={e => this.dragEnter(e)}
                onDragLeave={e => this.dragLeave(e)}
                onDragExit={e => this.dragLeave(e)}
                onDragOver={e => this.dragOver(e)}
                onDragEnd={e => this.dragEnd(e)}
            >
                {this.state.dragEntered ? <div className="drop-target" /> : null}
                <NavBar language={this.storeState.optionsPad.language} output={output} />
                <div className="main">
                    <SourcePad store={this.props.store} />
                    <OutputEditor
                        store={this.props.store}
                        rendering={this.state.rendering}
                        source={output}
                        language={this.storeState.optionsPad.language}
                        sourceType={this.storeState.sourcePad.sourceType}
                    />
                    <OptionsPad
                        store={this.props.store}
                        numberOfOutputFiles={this.state.output === undefined ? 0 : _.size(this.state.output)}
                        className={classNames({
                            hidden: embedded || !this.props.store.getState().layout.displayOptions
                        })}
                    />
                </div>
                {showJobsAd && <GlideJobsBar />}
            </div>
        );
    }

    private async downloadSource() {
        const files = this.state.output;
        const [{ topLevelName }] = this.storeState.sourcePad.sources;
        const language = defined(languageNamed(this.storeState.optionsPad.language));

        if (files === undefined) {
            return;
        }

        const filenames = Object.getOwnPropertyNames(files);

        if (filenames.length === 1) {
            const filename = filenames[0];
            const file = files[filename];
            download(
                file.lines.join("\n"),
                filename === "stdout" ? `${topLevelName}.${language.extension}` : filename,
                "text/plain"
            );
        } else {
            sendEvent("download zip");
            const name = `${topLevelName} ${language.displayName} (quicktype)`;
            const zip = new JSZip();
            const folder = zip.folder(name);
            for (const filename of filenames) {
                const source = files[filename].lines.join("\n");
                folder?.file(filename, source);
            }
            const data = await zip.generateAsync({ type: "blob" });
            download(data, `${name}.zip`, "application/zip");

            Toaster.show({
                message: `Downloaded zip file with source`,
                intent: Intent.SUCCESS,
                icon: "tick",
                timeout: 3500
            });
        }
    }

    private getWorkerRenderMessage(): WorkerRenderMessage {
        const { optionsPad, sourcePad } = this.storeState;
        const lang = optionsPad.language;
        const languageOptions = optionsPad.options[lang];
        const options: Partial<Options> = {
            lang,
            ...languageOptions,
            leadingComments: sourcePad.leadingComments,
            fixedTopLevels: sourcePad.sourceType === SourceType.Postman
        };
        const sourceType = this.source.sourceType;
        const sources = this.source.sources;
        return {
            options,
            sourceType,
            sources,
            receipt: hashCode().value([options, sourceType, sources])
        };
    }

    private clearPendingProgressToast() {
        if (this.progressToastTimer !== undefined) {
            clearInterval(this.progressToastTimer);
            this.progressToastTimer = undefined;
        }
    }

    private dismissProgressToast() {
        this.clearPendingProgressToast();
        if (this.progressToast) {
            Toaster.dismiss(this.progressToast.id);
            this.progressToast = undefined;
        }
    }

    private displayProgressToast(message: string) {
        this.clearPendingProgressToast();

        const props: IToastProps = {
            className: "progress-toast",
            message: (
                <div className="progress">
                    {message}
                    <ProgressBar intent={Intent.NONE} />
                </div>
            ),
            timeout: 60 * 1000
        };

        this.progressToastTimer = setTimeout(() => {
            this.progressToastTimer = undefined;

            if (this.progressToast) {
                Toaster.show(props, this.progressToast.id);
            } else {
                this.progressToast = { id: Toaster.show(props), time: new Date() };
            }
        }, PROGRESS_TOAST_WAIT);
    }

    private onAsyncRenderResult({ receipt, result, error }: AsyncSerializedRenderResult) {
        if (this.receipt !== receipt) {
            return;
        }

        this.clearPendingProgressToast();

        if (this.progressToast) {
            const { id, time } = this.progressToast;
            this.progressToast = undefined;

            setTimeout(() => {
                // Keep the toast on screen for at least a second so it doesn't flash
                const elapsedSincePresented = new Date().getTime() - time.getTime();
                const dismissDelay =
                    elapsedSincePresented > PROGRESS_TOAST_MIN_DURATION
                        ? 0
                        : PROGRESS_TOAST_MIN_DURATION - elapsedSincePresented;
                setTimeout(() => Toaster.dismiss(id), dismissDelay);
            }, 200 /* wait for output editor to fade in to avoid stuttering*/);
        }

        if (result !== undefined) {
            this.setState({ output: result, rendering: false });
            this.asyncRenderErrorToastKey = undefined;
        } else if (error !== undefined) {
            if (error.errorMessageKind !== undefined) {
                sendEvent("render error", error.errorMessageKind);
            }
            const props: IToastProps = {
                message: error.message,
                intent: Intent.DANGER,
                icon: "error",
                timeout: 30000
            };
            if (this.asyncRenderErrorToastKey !== undefined) {
                Toaster.show(props, this.asyncRenderErrorToastKey);
            } else {
                Toaster.show(props);
            }
        }
    }

    get source(): SourcePadState {
        return this.props.store.getState().sourcePad;
    }

    private dragOver = (ev: React.DragEvent<HTMLDivElement>) => {
        ev.preventDefault();

        if (!this.state.dragging) {
            this.setState({ dragging: true });
        }

        ev.dataTransfer.dropEffect = "copy";
    };

    private drop = async (ev: React.DragEvent<HTMLDivElement>) => {
        ev.preventDefault();
        this.clearDragging();

        const files = getValidFiles(ev);
        if (files.length === 0) {
            Toaster.show({
                message: "Please drop JSON files",
                icon: "info-sign"
            });
            return;
        }

        this.displayProgressToast(files.length === 1 ? `Reading ${files[0].name}...` : `Reading files...`);
        try {
            const sample = await samples.fromFiles(files);
            sendEvent("drop", sample.sourceType, sample.sources.length);

            if (sample.sourceType === SourceType.Postman && !sample.sources.some(s => s.samples.length > 0)) {
                Toaster.show({
                    intent: Intent.WARNING,
                    message: "Postman collection must contain sample JSON responses",
                    timeout: 8 * 1000
                });
                return;
            }

            this.props.store.dispatch(
                setSourceState({
                    sample: sample.name,
                    sources: sample.sources,
                    sourceType: sample.sourceType,
                    leadingComments: sample.leadingComments,
                    expandedNodes: [],
                    selectedNode: 0
                })
            );
        } catch (e) {
            Toaster.show({
                message: "Couldn't read files",
                intent: Intent.DANGER
            });
            return;
        } finally {
            setTimeout(() => this.dismissProgressToast(), 600);
        }
    };

    private clearDragging() {
        this.dragEnterCount = 0;
        this.setState({ dragging: false }, () => {
            setTimeout(() => this.setState({ dragEntered: false }), 300);
        });
    }

    private dragEnd(ev: React.DragEvent<HTMLDivElement>) {
        // Remove all of the drag data
        var dt = ev.dataTransfer;
        if (dt.items) {
            // Use DataTransferItemList interface to remove the drag data
            for (var i = 0; i < dt.items.length; i++) {
                dt.items.remove(i);
            }
        } else {
            // Use DataTransfer interface to remove the drag data
            ev.dataTransfer.clearData();
        }

        this.clearDragging();
    }

    private dragEnter = (ev: React.DragEvent<HTMLDivElement>) => {
        if (this.dragEnterCount === 0) {
            this.setState({ dragEntered: true }, () => {
                this.setState({ dragging: true });
            });
        }
        this.dragEnterCount += 1;
    };

    private dragLeave = (ev: React.DragEvent<HTMLDivElement>) => {
        this.dragEnterCount -= 1;
        if (this.dragEnterCount === 0) {
            this.setState({ dragging: false });
        }
    };
}

export default App;

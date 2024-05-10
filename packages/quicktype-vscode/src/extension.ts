"use strict";

import * as path from "path";

import {
    InputData,
    JSONSchemaInput,
    type Options,
    type RendererOptions,
    type SerializedRenderResult,
    type TargetLanguage,
    defaultTargetLanguages,
    inferenceFlagNames,
    isLanguageName,
    jsonInputForTargetLanguage,
    languageNamed,
    quicktype
} from "quicktype-core";
import { schemaForTypeScriptSources } from "quicktype-typescript-input";
// eslint-disable-next-line import/no-unresolved
import * as vscode from "vscode";

const configurationSection = "quicktype";

enum Command {
    PasteJSONAsTypes = "quicktype.pasteJSONAsTypes",
    PasteJSONAsTypesAndSerialization = "quicktype.pasteJSONAsTypesAndSerialization",
    PasteSchemaAsTypes = "quicktype.pasteJSONSchemaAsTypes",
    PasteSchemaAsTypesAndSerialization = "quicktype.pasteJSONSchemaAsTypesAndSerialization",
    PasteTypeScriptAsTypesAndSerialization = "quicktype.pasteTypeScriptAsTypesAndSerialization",
    OpenQuicktypeForJSON = "quicktype.openForJSON",
    OpenQuicktypeForJSONSchema = "quicktype.openForJSONSchema",
    OpenQuicktypeForTypeScript = "quicktype.openForTypeScript",
    ChangeTargetLanguage = "quicktype.changeTargetLanguage"
}

function jsonIsValid(json: string): boolean {
    try {
        JSON.parse(json);
    } catch (e) {
        return false;
    }

    return true;
}

async function promptTopLevelName(): Promise<{ cancelled: boolean; name: string }> {
    let topLevelName = await vscode.window.showInputBox({
        prompt: "Top-level type name?"
    });

    return {
        cancelled: topLevelName === undefined,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        name: topLevelName || "TopLevel"
    };
}

interface TargetLanguagePick {
    cancelled: boolean;
    lang: TargetLanguage;
}

async function pickTargetLanguage(): Promise<TargetLanguagePick> {
    const languageChoices = defaultTargetLanguages.map(l => l.displayName).sort();
    let chosenName = await vscode.window.showQuickPick(languageChoices);
    const cancelled = chosenName === undefined;
    if (chosenName === undefined || !isLanguageName(chosenName)) {
        return { cancelled, lang: languageNamed("typescript") };
    }

    return { cancelled, lang: languageNamed(chosenName) };
}

async function getTargetLanguage(editor: vscode.TextEditor): Promise<TargetLanguagePick> {
    const documentLanguage = editor.document.languageId;
    const languageName = isLanguageName(documentLanguage) ? documentLanguage : "typescript";
    const currentLanguage = languageNamed(languageName);
    if (currentLanguage !== undefined) {
        return {
            cancelled: false,
            lang: currentLanguage
        };
    }

    return await pickTargetLanguage();
}

type InputKind = "json" | "schema" | "typescript";

async function runQuicktype(
    content: string,
    kind: InputKind,
    lang: TargetLanguage,
    topLevelName: string,
    forceJustTypes: boolean,
    indentation: string | undefined
): Promise<SerializedRenderResult> {
    const configuration = vscode.workspace.getConfiguration(configurationSection);
    const justTypes = forceJustTypes || configuration.justTypes;

    const rendererOptions: RendererOptions = {};
    if (justTypes) {
        // FIXME: The target language should have a property to return these options.
        if (lang.name === "csharp") {
            rendererOptions.features = "just-types";
        } else if (lang.name === "kotlin") {
            rendererOptions.framework = "just-types";
        } else {
            rendererOptions["just-types"] = "true";
        }
    }

    const inputData = new InputData();
    switch (kind) {
        case "json":
            await inputData.addSource("json", { name: topLevelName, samples: [content] }, () =>
                jsonInputForTargetLanguage(lang)
            );
            break;
        case "schema":
            await inputData.addSource(
                "schema",
                { name: topLevelName, schema: content },
                () => new JSONSchemaInput(undefined)
            );
            break;
        case "typescript":
            await inputData.addSource(
                "schema",
                schemaForTypeScriptSources([`${topLevelName}.ts`]),
                () => new JSONSchemaInput(undefined)
            );
            break;
        default:
            throw new Error(`Unrecognized input format: ${kind}`);
    }

    const options: Partial<Options> = {
        lang: lang,
        inputData,
        rendererOptions,
        indentation,
        inferMaps: configuration.inferMaps,
        inferEnums: configuration.inferEnums,
        inferDateTimes: configuration.inferDateTimes,
        inferIntegerStrings: configuration.inferIntegerStrings
    };
    for (const flag of inferenceFlagNames) {
        if (typeof configuration[flag] === "boolean") {
            options[flag] = configuration[flag];
        }
    }

    return await quicktype(options);
}

async function pasteAsTypes(editor: vscode.TextEditor, kind: InputKind, justTypes: boolean): Promise<unknown> {
    let indentation: string;
    if (editor.options.insertSpaces) {
        const tabSize = editor.options.tabSize as number;
        indentation = " ".repeat(tabSize);
    } else {
        indentation = "\t";
    }

    const language = await getTargetLanguage(editor);
    if (language.cancelled) {
        return;
    }

    let content: string;
    try {
        content = await vscode.env.clipboard.readText();
    } catch (e) {
        return await vscode.window.showErrorMessage("Could not get clipboard contents");
    }

    if (kind !== "typescript" && !jsonIsValid(content)) {
        return await vscode.window.showErrorMessage("Clipboard does not contain valid JSON.");
    }

    let topLevelName: string;
    if (kind === "typescript") {
        topLevelName = "input";
    } else {
        const tln = await promptTopLevelName();
        if (tln.cancelled) {
            return;
        }

        topLevelName = tln.name;
    }

    let result: SerializedRenderResult;
    try {
        result = await runQuicktype(content, kind, language.lang, topLevelName, justTypes, indentation);
    } catch (e) {
        // TODO Invalid JSON produces an uncatchable exception from quicktype
        // Fix this so we can catch and show an error message.
        if (typeof e === "string") {
            return await vscode.window.showErrorMessage(e);
        }
    }

    // @ts-expect-error FIXME: resolve this after above ^
    const text = result.lines.join("\n");
    const selection = editor.selection;
    return await editor.edit(builder => {
        if (selection.isEmpty) {
            builder.insert(selection.start, text);
        } else {
            builder.replace(new vscode.Range(selection.start, selection.end), text);
        }
    });
}

class CodeProvider implements vscode.TextDocumentContentProvider {
    public readonly scheme: string = "quicktype";

    public readonly uri: vscode.Uri;

    private _documentText: string = "{}";

    private _targetCode = "";

    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();

    private readonly _changeSubscription: vscode.Disposable;

    private readonly _onDidChangeVisibleTextEditors: vscode.Disposable;

    private readonly _onDidChangeConfiguration: vscode.Disposable;

    private _isOpen = false;

    private _timer: NodeJS.Timeout | undefined = undefined;

    public constructor(
        private _inputKind: InputKind,
        private readonly _targetLanguage: TargetLanguage,
        private _document: vscode.TextDocument
    ) {
        this.scheme = `quicktype-${this._targetLanguage.name}`;
        // TODO use this.documentName instead of QuickType in uri
        this.uri = vscode.Uri.parse(`${this.scheme}:QuickType.${this._targetLanguage.extension}`);

        this._changeSubscription = vscode.workspace.onDidChangeTextDocument(ev => this.textDidChange(ev));
        this._onDidChangeVisibleTextEditors = vscode.window.onDidChangeVisibleTextEditors(editors =>
            this.visibleTextEditorsDidChange([...editors])
        );
        this._onDidChangeConfiguration = vscode.workspace.onDidChangeConfiguration(ev =>
            this.configurationDidChange(ev)
        );
    }

    public dispose(): void {
        this._onDidChange.dispose();
        this._changeSubscription.dispose();
        this._onDidChangeVisibleTextEditors.dispose();
        this._onDidChangeConfiguration.dispose();
    }

    public get inputKind(): InputKind {
        return this._inputKind;
    }

    public setInputKind(inputKind: InputKind): void {
        this._inputKind = inputKind;
    }

    public get document(): vscode.TextDocument {
        return this._document;
    }

    public get documentName(): string {
        const basename = path.basename(this.document.fileName);
        const extIndex = basename.lastIndexOf(".");
        return extIndex === -1 ? basename : basename.substring(0, extIndex);
    }

    public setDocument(document: vscode.TextDocument): void {
        this._document = document;
    }

    public get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    private visibleTextEditorsDidChange(editors: vscode.TextEditor[]): void {
        const isOpen = editors.some(e => e.document.uri.scheme === this.scheme);
        if (!this._isOpen && isOpen) {
            void this.update();
        }

        this._isOpen = isOpen;
    }

    private configurationDidChange(ev: vscode.ConfigurationChangeEvent): void {
        if (ev.affectsConfiguration(configurationSection)) {
            void this.update();
        }
    }

    private textDidChange(ev: vscode.TextDocumentChangeEvent): void {
        if (!this._isOpen) return;

        if (ev.document !== this._document) return;

        if (this._timer) {
            clearTimeout(this._timer);
        }

        this._timer = setTimeout(() => {
            this._timer = undefined;
            void this.update();
        }, 300);
    }

    public async update(): Promise<void> {
        this._documentText = this._document.getText();

        try {
            const result = await runQuicktype(
                this._documentText,
                this._inputKind,
                this._targetLanguage,
                this.documentName,
                false,
                undefined
            );
            this._targetCode = result.lines.join("\n");

            if (!this._isOpen) return;

            this._onDidChange.fire(this.uri);
        } catch (e) {
            // FIXME
        }
    }

    public provideTextDocumentContent(
        _uri: vscode.Uri,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<string> {
        this._isOpen = true;

        return this._targetCode;
    }
}

function deduceTargetLanguage(): TargetLanguage {
    const documents = vscode.workspace.textDocuments;
    const counts = new Map<string, number>();
    for (const doc of documents) {
        const name = doc.languageId;
        let count = counts.get(name);
        if (count === undefined) {
            count = 0;
        }

        count += 1;
        counts.set(name, count);
    }

    const sorted = Array.from(counts).sort(([_na, ca], [_nb, cb]) => cb - ca);
    for (const [name] of sorted) {
        if (isLanguageName(name)) {
            return languageNamed(name);
        }
    }

    return languageNamed("typescript");
}

const lastTargetLanguageUsedKey = "lastTargetLanguageUsed";

let extensionContext: vscode.ExtensionContext | undefined = undefined;

const codeProviders: Map<string, CodeProvider> = new Map();

let lastCodeProvider: CodeProvider | undefined = undefined;
let explicitlySetTargetLanguage: TargetLanguage | undefined = undefined;

async function openQuicktype(
    inputKind: InputKind,
    targetLanguage: TargetLanguage,
    document: vscode.TextDocument
): Promise<vscode.TextEditor> {
    let codeProvider = codeProviders.get(targetLanguage.name);
    if (codeProvider === undefined) {
        codeProvider = new CodeProvider(inputKind, targetLanguage, document);
        codeProviders.set(targetLanguage.name, codeProvider);
        if (extensionContext !== undefined) {
            extensionContext.subscriptions.push(
                vscode.workspace.registerTextDocumentContentProvider(codeProvider.scheme, codeProvider)
            );
        }
    } else {
        codeProvider.setInputKind(inputKind);
        codeProvider.setDocument(document);
    }

    let originalEditor: vscode.TextEditor | undefined;
    if (lastCodeProvider !== undefined) {
        const lastDoc = lastCodeProvider.document;
        originalEditor = vscode.window.visibleTextEditors.find(e => e.document === lastDoc);
    }

    if (originalEditor === undefined) {
        originalEditor = vscode.window.activeTextEditor;
    }

    let column: number;
    if (originalEditor?.viewColumn !== undefined) {
        column = originalEditor.viewColumn + 1;
    } else {
        column = 0;
    }

    lastCodeProvider = codeProvider;

    await codeProvider.update();
    const doc = await vscode.workspace.openTextDocument(codeProvider.uri);
    return await vscode.window.showTextDocument(doc, column, true);
}

async function openForEditor(editor: vscode.TextEditor, inputKind: InputKind): Promise<void> {
    const targetLanguage = explicitlySetTargetLanguage ?? deduceTargetLanguage();
    await openQuicktype(inputKind, targetLanguage, editor.document);
}

async function changeTargetLanguage(): Promise<void> {
    const pick = await pickTargetLanguage();
    if (pick.cancelled) return;

    explicitlySetTargetLanguage = pick.lang;
    if (lastCodeProvider === undefined) return;

    await openQuicktype(lastCodeProvider.inputKind, explicitlySetTargetLanguage, lastCodeProvider.document);

    await extensionContext?.workspaceState.update(lastTargetLanguageUsedKey, explicitlySetTargetLanguage.name);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    extensionContext = context;

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand(
            Command.PasteJSONAsTypes,
            async editor => await pasteAsTypes(editor, "json", true)
        ),
        vscode.commands.registerTextEditorCommand(
            Command.PasteJSONAsTypesAndSerialization,
            async editor => await pasteAsTypes(editor, "json", false)
        ),
        vscode.commands.registerTextEditorCommand(
            Command.PasteSchemaAsTypes,
            async editor => await pasteAsTypes(editor, "schema", true)
        ),
        vscode.commands.registerTextEditorCommand(
            Command.PasteSchemaAsTypesAndSerialization,
            async editor => await pasteAsTypes(editor, "schema", false)
        ),
        vscode.commands.registerTextEditorCommand(
            Command.PasteTypeScriptAsTypesAndSerialization,
            async editor => await pasteAsTypes(editor, "typescript", false)
        ),
        vscode.commands.registerTextEditorCommand(
            Command.OpenQuicktypeForJSON,
            async editor => await openForEditor(editor, "json")
        ),
        vscode.commands.registerTextEditorCommand(
            Command.OpenQuicktypeForJSONSchema,
            async editor => await openForEditor(editor, "schema")
        ),
        vscode.commands.registerTextEditorCommand(
            Command.OpenQuicktypeForTypeScript,
            async editor => await openForEditor(editor, "typescript")
        ),
        vscode.commands.registerCommand(Command.ChangeTargetLanguage, changeTargetLanguage)
    );

    const maybeName = extensionContext.workspaceState.get<string>(lastTargetLanguageUsedKey);
    if (typeof maybeName === "string" && isLanguageName(maybeName)) {
        explicitlySetTargetLanguage = languageNamed(maybeName);
    }
}

export function deactivate(): void {
    return;
}

import { quicktypeMultiFile, QuickTypeError, panic } from "quicktype-core";

import { AsyncSerializedRenderResult, RenderError, Files, makeTypeSources } from "./quicktype";

import { WorkerRenderMessage } from "./types";

function makeRenderError(error: any): RenderError {
    let errorMessageKind: string | undefined;
    // `error instanceof QuickTypeError` does not work
    if (typeof error.messageName === "string") {
        const qtError = error as QuickTypeError;
        if (qtError.messageName !== "InternalError") {
            // error is due to user input
            // This is an ErrorMessage enum string from quicktype
            // we cannot currently recover the enum name, which would be nice
            errorMessageKind = error.messageName;
        }
    }

    return { message: error.message, errorMessageKind };
}

async function render({
    options,
    sourceType,
    sources
}: WorkerRenderMessage): Promise<{ result?: Files; error?: RenderError }> {
    let result: Files | undefined;
    let renderError: RenderError | undefined;

    if (typeof options.lang !== "string") {
        return panic("Target language must be a string");
    }

    options.inputData = await makeTypeSources(sourceType, sources, options.lang);

    try {
        result = {};
        const filemap = await quicktypeMultiFile(options);
        for (const [filename, output] of filemap as any) {
            result[filename] = output;
        }
    } catch (error) {
        // We can't serialize Errors to send back to the app, but we
        // also can't report Google Analytics on the worker, so we
        // report the exception here (unless there's a errorMessageKind)
        // and we do analytics with the userErrorMessage
        renderError = makeRenderError(error);
        if (renderError.errorMessageKind === undefined) {
            // This was an unexpected error
            // Disabling this for now, as we're not working on these errors for quicktype atm
            // raven.captureException(error);
        }
    }
    return { result, error: renderError };
}

const reply: (result: AsyncSerializedRenderResult) => void = postMessage as any;

/* eslint-disable-next-line no-restricted-globals */
self.addEventListener("message", async ({ data }: { data: WorkerRenderMessage }) => {
    reply({
        ...(await render(data)),
        receipt: data.receipt
    });
});

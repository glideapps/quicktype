import { Scala3Renderer } from "./Scala3Renderer";

export class UpickleRenderer extends Scala3Renderer {
    protected emitClassDefinitionMethods(): void {
        this.emitLine(") derives ReadWriter ");
    }

    protected emitHeader(): void {
        super.emitHeader();

        this.emitLine("import upickle.default.*");
        this.ensureBlankLine();
    }
}

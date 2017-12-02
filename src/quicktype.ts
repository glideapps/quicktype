import * as _ from "lodash";
import { Run, Options, usage } from "./index";

export async function main(args: string[] | Options) {
    if (_.isArray(args) && args.length === 0) {
        usage();
    } else {
        let run = new Run(args, false);
        await run.runAndPrint();
    }
}

if (require.main === module) {
    main(process.argv.slice(2)).catch(reason => {
        console.error(reason);
        process.exit(1);
    });
}

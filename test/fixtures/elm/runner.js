const { Elm } = require("./elm.js");
const fs = require("fs");

const app = Elm.Main.init();

app.ports.toJS.subscribe((result) => {
    if (result.startsWith("Error: ")) {
        process.stderr.write(result + "\n", () => {
            process.exit(1);
        });
    } else {
        process.stdout.write(result + "\n", () => {
            process.exit(0);
        });
    }
});

app.ports.fromJS.send(fs.readFileSync(process.argv[2], "utf8"));

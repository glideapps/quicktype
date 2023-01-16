const Elm = require("./elm.js");
const fs = require("fs");

let ports = Elm.Main.worker().ports;

ports.toJS.subscribe(function (result) {
    if (result.startsWith("Error: ")) {
        process.stderr.write(result + "\n", function () {
            process.exit(1);
        });
    } else {
        process.stdout.write(result + "\n", function () {
            process.exit(0);
        });
    }
});

ports.fromJS.send(fs.readFileSync(process.argv[2], "utf8"));

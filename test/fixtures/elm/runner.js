const Elm = require("./elm.js").Elm;
const fs = require("fs");

let app = Elm.Main.init();

app.ports.toJS.subscribe(function(result) {
    if (result.startsWith("Error: ")) {
        process.stderr.write(result + "\n", function() { process.exit(1); });
    } else {
        process.stdout.write(result + "\n", function() { process.exit(0); });
    }
});

app.ports.fromJS.send(fs.readFileSync(process.argv[2], "utf8"));

const Elm = require("./elm.js");
const fs = require("fs");

let ports = Elm.Main.worker().ports;

ports.toJS.subscribe(function(result) {
    if (result === "Ok") {
        console.log("Success");
        process.exit(0);
    } else {
        console.log(result);
        process.exit(1);
    }
});

ports.fromJS.send(fs.readFileSync(process.argv[2], "utf8"));


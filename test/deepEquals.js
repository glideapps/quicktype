function pathToString(path) {
    return path.join(".");
}

// https://stackoverflow.com/questions/1068834/object-comparison-in-javascript
function deepEquals(x, y, path) {
    path = path || [];

    var i;
    var p;

    // remember that NaN === NaN returns false
    // and isNaN(undefined) returns true
    if (typeof x === 'number' && typeof y === 'number') {
        if (isNaN(x) && isNaN(y))
            return true;
        // because sometimes Newtonsoft.JSON is not exact
        return Math.fround(x) === Math.fround(y);
    }

    // Compare primitives and functions.     
    // Check if both arguments link to the same object.
    // Especially useful on the step where we compare prototypes
    if (x === y) {
        return true;
    }

    if ((x instanceof String && y instanceof String) || (x instanceof Number && y instanceof Number)) {
        if (x.toString() !== y.toString()) {
            console.error(`Number or string not equal at path ${pathToString(path)}.`);
            return false;
        }
        return true;
    }

    // At last checking prototypes as good as we can
    if (!(x instanceof Object && y instanceof Object)) {
        console.error(`One is not an object at path ${pathToString(path)}.`)
        return false;
    }

    if (x.constructor !== y.constructor) {
        console.error(`Not the same constructor at path ${pathToString(path)}.`);
        return false;
    }

    if (x.prototype !== y.prototype) {
        console.error(`Not the same prototype at path ${pathToString(path)}.`);
        return false;
    }

    if (Array.isArray(x)) {
        if (x.length !== y.length){
            console.error(`Arrays don't have the same length at path ${pathToString(path)}.`);
            return false;
        }
        for (i = 0; i < x.length; i++) {
            path.push(i)
            if (!deepEquals(x[i], y[i], path))
                return false;
            path.pop();
        }
        return true;
    }

    for (p in y) {
        // We allow properties in y that aren't present in x
        // so long as they're null.
        if (y.hasOwnProperty(p) && !x.hasOwnProperty(p)) {
            if (y[p] !== null) {
                console.error(`Non-null property ${p} is not expected at path ${pathToString(path)}.`);
                return false;
            }
            continue;
        }
        if (typeof y[p] !== typeof x[p]) {
            console.error(`Properties ${p} don't have the same types at path ${pathToString(path)}.`);
            return false;
        }
    }
    
    for (p in x) {
        if (x.hasOwnProperty(p) && !y.hasOwnProperty(p)) {
            console.error(`Expected property ${p} not found at path ${pathToString(path)}.`);
            return false;
        }
        if (typeof x[p] !== typeof y[p]) {
            console.error(`Properties ${p} don't have the same types at path ${pathToString(path)}.`);
            return false;
        }

        switch (typeof(x[p])) {
        case 'object':
            path.push(p);
            if (!deepEquals(x[p], y[p], path)) {
                return false;
            }
            path.pop(p);
            break;
            
        default:
            if (x[p] !== y[p]) {
                console.error(`Non-object properties ${p} are not equal at path ${pathToString(path)}.`)
                return false;
            }
            break;
        }
    }
    
    return true;
}

module.exports = deepEquals;
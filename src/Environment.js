"use strict";

function isNode() {
    var node = false;
 
    // Only Node.JS has a process variable that is of [[Class]] process 
    try {
        node = Object.prototype.toString.call(global.process) === '[object process]' 
    } catch(e) {}

    return node;
}

exports._getHostname = function(p) {
    try {
        var hostname = window && window.location && window.location.hostname;
        return hostname ? p.toJust(hostname) : p.nothing;
    } catch (e) {}

    return p.nothing;
};

exports._getNodeEnv = function(p) {
    return isNode() ? p.toJust(process.env.NODE_ENV || "") : p.nothing;
};

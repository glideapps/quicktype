"use strict";
// https://github.com/epoberezkin/ajv/blob/4d76c6fb813b136b6ec4fe74990bc97233d75dea/lib/compile/formats.js
Object.defineProperty(exports, "__esModule", { value: true });
/*
The MIT License (MIT)

Copyright (c) 2015 Evgeny Poberezkin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
const DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
const DAYS = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const TIME = /^(\d\d):(\d\d):(\d\d)(\.\d+)?(z|[+-]\d\d:\d\d)?$/i;
const DATE_TIME_SEPARATOR = /t|\s/i;
class DefaultDateTimeRecognizer {
    isDate(str) {
        // full-date from http://tools.ietf.org/html/rfc3339#section-5.6
        const matches = str.match(DATE);
        if (matches === null)
            return false;
        const month = +matches[2];
        const day = +matches[3];
        return month >= 1 && month <= 12 && day >= 1 && day <= DAYS[month];
    }
    isTime(str) {
        const matches = str.match(TIME);
        if (matches === null)
            return false;
        const hour = +matches[1];
        const minute = +matches[2];
        const second = +matches[3];
        return hour <= 23 && minute <= 59 && second <= 59;
    }
    isDateTime(str) {
        // http://tools.ietf.org/html/rfc3339#section-5.6
        const dateTime = str.split(DATE_TIME_SEPARATOR);
        return dateTime.length === 2 && this.isDate(dateTime[0]) && this.isTime(dateTime[1]);
    }
}
exports.DefaultDateTimeRecognizer = DefaultDateTimeRecognizer;

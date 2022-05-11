export interface DateTimeRecognizer {
    isDate(s: string): boolean;
    isTime(s: string): boolean;
    isDateTime(s: string): boolean;
}
export declare class DefaultDateTimeRecognizer implements DateTimeRecognizer {
    isDate(str: string): boolean;
    isTime(str: string): boolean;
    isDateTime(str: string): boolean;
}

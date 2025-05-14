import type { Sourcelike } from "../../Source";

import type { JavaRenderer } from "./JavaRenderer";

export abstract class JavaDateTimeProvider {
    public constructor(
        protected readonly _renderer: JavaRenderer,
        protected readonly _className: string,
    ) {}

    public abstract keywords: string[];

    public abstract dateTimeImports: string[];

    public abstract dateImports: string[];

    public abstract timeImports: string[];

    public abstract converterImports: string[];

    public abstract dateTimeType: string;

    public abstract dateType: string;

    public abstract timeType: string;

    public abstract dateTimeJacksonAnnotations: string[];

    public abstract dateJacksonAnnotations: string[];

    public abstract timeJacksonAnnotations: string[];

    public abstract emitDateTimeConverters(): void;

    public shouldEmitDateTimeConverter = true;

    public shouldEmitTimeConverter = true;

    public shouldEmitDateConverter = true;

    public abstract convertStringToDateTime(variable: Sourcelike): Sourcelike;
    public abstract convertStringToTime(variable: Sourcelike): Sourcelike;
    public abstract convertStringToDate(variable: Sourcelike): Sourcelike;

    public abstract convertDateTimeToString(variable: Sourcelike): Sourcelike;
    public abstract convertTimeToString(variable: Sourcelike): Sourcelike;
    public abstract convertDateToString(variable: Sourcelike): Sourcelike;
}

export class Java8DateTimeProvider extends JavaDateTimeProvider {
    public keywords = [
        "LocalDate",
        "OffsetDateTime",
        "OffsetTime",
        "ZoneOffset",
        "ZonedDateTime",
        "DateTimeFormatter",
        "DateTimeFormatterBuilder",
        "ChronoField",
    ];

    public dateTimeImports: string[] = ["java.time.OffsetDateTime"];

    public dateImports: string[] = ["java.time.LocalDate"];

    public timeImports: string[] = ["java.time.OffsetTime"];

    public converterImports: string[] = [
        "java.time.LocalDate",
        "java.time.OffsetDateTime",
        "java.time.OffsetTime",
        "java.time.ZoneOffset",
        "java.time.ZonedDateTime",
        "java.time.format.DateTimeFormatter",
        "java.time.format.DateTimeFormatterBuilder",
        "java.time.temporal.ChronoField",
    ];

    public dateTimeType = "OffsetDateTime";

    public dateType = "LocalDate";

    public timeType = "OffsetTime";

    public dateTimeJacksonAnnotations: string[] = [];

    public dateJacksonAnnotations: string[] = [];

    public timeJacksonAnnotations: string[] = [];

    public emitDateTimeConverters(): void {
        this._renderer.ensureBlankLine();
        this._renderer.emitLine(
            "private static final DateTimeFormatter DATE_TIME_FORMATTER = new DateTimeFormatterBuilder()",
        );
        this._renderer.indent(() =>
            this._renderer.indent(() => {
                this._renderer.emitLine(
                    ".appendOptional(DateTimeFormatter.ISO_DATE_TIME)",
                );
                this._renderer.emitLine(
                    ".appendOptional(DateTimeFormatter.ISO_OFFSET_DATE_TIME)",
                );
                this._renderer.emitLine(
                    ".appendOptional(DateTimeFormatter.ISO_INSTANT)",
                );
                this._renderer.emitLine(
                    '.appendOptional(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SX"))',
                );
                this._renderer.emitLine(
                    '.appendOptional(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ssX"))',
                );
                this._renderer.emitLine(
                    '.appendOptional(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))',
                );
                this._renderer.emitLine(".toFormatter()");
                this._renderer.emitLine(".withZone(ZoneOffset.UTC);");
            }),
        );
        this._renderer.ensureBlankLine();
        this._renderer.emitBlock(
            "public static OffsetDateTime parseDateTimeString(String str)",
            () => {
                this._renderer.emitLine(
                    "return ZonedDateTime.from(Converter.DATE_TIME_FORMATTER.parse(str)).toOffsetDateTime();",
                );
            },
        );

        this._renderer.ensureBlankLine();
        this._renderer.emitLine(
            "private static final DateTimeFormatter TIME_FORMATTER = new DateTimeFormatterBuilder()",
        );
        this._renderer.indent(() =>
            this._renderer.indent(() => {
                this._renderer.emitLine(
                    ".appendOptional(DateTimeFormatter.ISO_TIME)",
                );
                this._renderer.emitLine(
                    ".appendOptional(DateTimeFormatter.ISO_OFFSET_TIME)",
                );
                this._renderer.emitLine(
                    ".parseDefaulting(ChronoField.YEAR, 2020)",
                );
                this._renderer.emitLine(
                    ".parseDefaulting(ChronoField.MONTH_OF_YEAR, 1)",
                );
                this._renderer.emitLine(
                    ".parseDefaulting(ChronoField.DAY_OF_MONTH, 1)",
                );
                this._renderer.emitLine(".toFormatter()");
                this._renderer.emitLine(".withZone(ZoneOffset.UTC);");
            }),
        );
        this._renderer.ensureBlankLine();
        this._renderer.emitBlock(
            "public static OffsetTime parseTimeString(String str)",
            () => {
                this._renderer.emitLine(
                    "return ZonedDateTime.from(Converter.TIME_FORMATTER.parse(str)).toOffsetDateTime().toOffsetTime();",
                );
            },
        );
    }

    public convertStringToDateTime(variable: Sourcelike): Sourcelike {
        return [this._className, ".parseDateTimeString(", variable, ")"];
    }

    public convertStringToTime(variable: Sourcelike): Sourcelike {
        return [this._className, ".parseTimeString(", variable, ")"];
    }

    public convertStringToDate(variable: Sourcelike): Sourcelike {
        return ["LocalDate.parse(", variable, ")"];
    }

    public convertDateTimeToString(variable: Sourcelike): Sourcelike {
        return [
            variable,
            ".format(java.time.format.DateTimeFormatter.ISO_OFFSET_DATE_TIME)",
        ];
    }

    public convertTimeToString(variable: Sourcelike): Sourcelike {
        return [
            variable,
            ".format(java.time.format.DateTimeFormatter.ISO_OFFSET_TIME)",
        ];
    }

    public convertDateToString(variable: Sourcelike): Sourcelike {
        return [
            variable,
            ".format(java.time.format.DateTimeFormatter.ISO_DATE)",
        ];
    }
}
export class JavaLegacyDateTimeProvider extends JavaDateTimeProvider {
    public keywords = ["SimpleDateFormat", "Date"];

    public dateTimeImports: string[] = ["java.util.Date"];

    public dateImports: string[] = ["java.util.Date"];

    public timeImports: string[] = ["java.util.Date"];

    public converterImports: string[] = [
        "java.util.Date",
        "java.text.SimpleDateFormat",
    ];

    public dateTimeType = "Date";

    public dateType = "Date";

    public timeType = "Date";

    public dateTimeJacksonAnnotations: string[] = [
        '@JsonFormat(pattern = "yyyy-MM-dd\'T\'HH:mm:ssX", timezone = "UTC")',
    ];

    public dateJacksonAnnotations: string[] = [
        '@JsonFormat(pattern = "yyyy-MM-dd")',
    ];

    public timeJacksonAnnotations: string[] = [
        '@JsonFormat(pattern = "HH:mm:ssX", timezone = "UTC")',
    ];

    public shouldEmitTimeConverter = false;

    public shouldEmitDateConverter = false;

    public emitDateTimeConverters(): void {
        this._renderer.ensureBlankLine();
        this._renderer.emitLine(
            "private static final String[] DATE_TIME_FORMATS = {",
        );
        this._renderer.indent(() =>
            this._renderer.indent(() => {
                this._renderer.emitLine("\"yyyy-MM-dd'T'HH:mm:ss.SX\",");
                this._renderer.emitLine("\"yyyy-MM-dd'T'HH:mm:ss.S\",");
                this._renderer.emitLine("\"yyyy-MM-dd'T'HH:mm:ssX\",");
                this._renderer.emitLine("\"yyyy-MM-dd'T'HH:mm:ss\",");
                this._renderer.emitLine('"yyyy-MM-dd HH:mm:ss.SX",');
                this._renderer.emitLine('"yyyy-MM-dd HH:mm:ss.S",');
                this._renderer.emitLine('"yyyy-MM-dd HH:mm:ssX",');
                this._renderer.emitLine('"yyyy-MM-dd HH:mm:ss",');
                this._renderer.emitLine('"HH:mm:ss.SZ",');
                this._renderer.emitLine('"HH:mm:ss.S",');
                this._renderer.emitLine('"HH:mm:ssZ",');
                this._renderer.emitLine('"HH:mm:ss",');
                this._renderer.emitLine('"yyyy-MM-dd",');
            }),
        );
        this._renderer.emitLine("};");
        this._renderer.ensureBlankLine();
        this._renderer.emitBlock(
            "public static Date parseAllDateTimeString(String str)",
            () => {
                this._renderer.emitBlock(
                    "for (String format : DATE_TIME_FORMATS)",
                    () => {
                        this._renderer.emitIgnoredTryCatchBlock(() => {
                            this._renderer.emitLine(
                                "return new SimpleDateFormat(format).parse(str);",
                            );
                        });
                    },
                );
                this._renderer.emitLine("return null;");
            },
        );

        this._renderer.ensureBlankLine();
        this._renderer.emitBlock(
            "public static String serializeDateTime(Date datetime)",
            () => {
                this._renderer.emitLine(
                    "return new SimpleDateFormat(\"yyyy-MM-dd'T'hh:mm:ssZ\").format(datetime);",
                );
            },
        );

        this._renderer.ensureBlankLine();
        this._renderer.emitBlock(
            "public static String serializeDate(Date datetime)",
            () => {
                this._renderer.emitLine(
                    'return new SimpleDateFormat("yyyy-MM-dd").format(datetime);',
                );
            },
        );

        this._renderer.ensureBlankLine();
        this._renderer.emitBlock(
            "public static String serializeTime(Date datetime)",
            () => {
                this._renderer.emitLine(
                    'return new SimpleDateFormat("hh:mm:ssZ").format(datetime);',
                );
            },
        );
    }

    public convertStringToDateTime(variable: Sourcelike): Sourcelike {
        return [this._className, ".parseAllDateTimeString(", variable, ")"];
    }

    public convertStringToTime(variable: Sourcelike): Sourcelike {
        return [this._className, ".parseAllDateTimeString(", variable, ")"];
    }

    public convertStringToDate(variable: Sourcelike): Sourcelike {
        return [this._className, ".parseAllDateTimeString(", variable, ")"];
    }

    public convertDateTimeToString(variable: Sourcelike): Sourcelike {
        return [this._className, ".serializeDateTime(", variable, ")"];
    }

    public convertTimeToString(variable: Sourcelike): Sourcelike {
        return [this._className, ".serializeTime(", variable, ")"];
    }

    public convertDateToString(variable: Sourcelike): Sourcelike {
        return [this._className, ".serializeDate(", variable, ")"];
    }
}

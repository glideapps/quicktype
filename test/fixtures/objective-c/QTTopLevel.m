#import "QTTopLevel.h"

// Shorthand for simple blocks
#define λ(decl, expr) (^(decl) { return (expr); })

// nil → NSNull conversion for JSON dictionaries
#define NSNullify(x) ([x isNotEqualTo:[NSNull null]] ? x : [NSNull null])

NS_ASSUME_NONNULL_BEGIN

// MARK: Private model interfaces

@interface QTTopLevel (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTTopLevelData (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTChild (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTChildData (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTMediaEmbed (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTPreview (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTImage (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTResolution (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTVariants (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTGIF (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

// These enum-like reference types are needed so that enum
// values can be contained by NSArray and NSDictionary.

@implementation QTDomain
+ (NSDictionary<NSString *, QTDomain *> *)values
{
    static NSDictionary<NSString *, QTDomain *> *values;
    return values = values ? values : @{
        @"i.imgur.com": [[QTDomain alloc] initWithValue:@"i.imgur.com"],
        @"i.redd.it": [[QTDomain alloc] initWithValue:@"i.redd.it"],
        @"imgur.com": [[QTDomain alloc] initWithValue:@"imgur.com"],
        @"reddit.com": [[QTDomain alloc] initWithValue:@"reddit.com"],
    };
}

+ (QTDomain *)iImgurCOM { return QTDomain.values[@"i.imgur.com"]; }
+ (QTDomain *)iReddIt { return QTDomain.values[@"i.redd.it"]; }
+ (QTDomain *)imgurCOM { return QTDomain.values[@"imgur.com"]; }
+ (QTDomain *)redditCOM { return QTDomain.values[@"reddit.com"]; }

+ (instancetype _Nullable)withValue:(NSString *)value
{
    return QTDomain.values[value];
}

- (instancetype)initWithValue:(NSString *)value
{
    if (self = [super init]) _value = value;
    return self;
}

- (NSUInteger)hash { return _value.hash; }
@end

@implementation QTWhitelistStatus
+ (NSDictionary<NSString *, QTWhitelistStatus *> *)values
{
    static NSDictionary<NSString *, QTWhitelistStatus *> *values;
    return values = values ? values : @{
        @"all_ads": [[QTWhitelistStatus alloc] initWithValue:@"all_ads"],
    };
}

+ (QTWhitelistStatus *)allAds { return QTWhitelistStatus.values[@"all_ads"]; }

+ (instancetype _Nullable)withValue:(NSString *)value
{
    return QTWhitelistStatus.values[value];
}

- (instancetype)initWithValue:(NSString *)value
{
    if (self = [super init]) _value = value;
    return self;
}

- (NSUInteger)hash { return _value.hash; }
@end

@implementation QTPostHint
+ (NSDictionary<NSString *, QTPostHint *> *)values
{
    static NSDictionary<NSString *, QTPostHint *> *values;
    return values = values ? values : @{
        @"image": [[QTPostHint alloc] initWithValue:@"image"],
        @"link": [[QTPostHint alloc] initWithValue:@"link"],
    };
}

+ (QTPostHint *)image { return QTPostHint.values[@"image"]; }
+ (QTPostHint *)link { return QTPostHint.values[@"link"]; }

+ (instancetype _Nullable)withValue:(NSString *)value
{
    return QTPostHint.values[value];
}

- (instancetype)initWithValue:(NSString *)value
{
    if (self = [super init]) _value = value;
    return self;
}

- (NSUInteger)hash { return _value.hash; }
@end

@implementation QTSelftext
+ (NSDictionary<NSString *, QTSelftext *> *)values
{
    static NSDictionary<NSString *, QTSelftext *> *values;
    return values = values ? values : @{
        @"": [[QTSelftext alloc] initWithValue:@""],
    };
}

+ (QTSelftext *)empty { return QTSelftext.values[@""]; }

+ (instancetype _Nullable)withValue:(NSString *)value
{
    return QTSelftext.values[value];
}

- (instancetype)initWithValue:(NSString *)value
{
    if (self = [super init]) _value = value;
    return self;
}

- (NSUInteger)hash { return _value.hash; }
@end

@implementation QTSubreddit
+ (NSDictionary<NSString *, QTSubreddit *> *)values
{
    static NSDictionary<NSString *, QTSubreddit *> *values;
    return values = values ? values : @{
        @"funny": [[QTSubreddit alloc] initWithValue:@"funny"],
    };
}

+ (QTSubreddit *)funny { return QTSubreddit.values[@"funny"]; }

+ (instancetype _Nullable)withValue:(NSString *)value
{
    return QTSubreddit.values[value];
}

- (instancetype)initWithValue:(NSString *)value
{
    if (self = [super init]) _value = value;
    return self;
}

- (NSUInteger)hash { return _value.hash; }
@end

@implementation QTSubredditID
+ (NSDictionary<NSString *, QTSubredditID *> *)values
{
    static NSDictionary<NSString *, QTSubredditID *> *values;
    return values = values ? values : @{
        @"t5_2qh33": [[QTSubredditID alloc] initWithValue:@"t5_2qh33"],
    };
}

+ (QTSubredditID *)t52Qh33 { return QTSubredditID.values[@"t5_2qh33"]; }

+ (instancetype _Nullable)withValue:(NSString *)value
{
    return QTSubredditID.values[value];
}

- (instancetype)initWithValue:(NSString *)value
{
    if (self = [super init]) _value = value;
    return self;
}

- (NSUInteger)hash { return _value.hash; }
@end

@implementation QTSubredditNamePrefixed
+ (NSDictionary<NSString *, QTSubredditNamePrefixed *> *)values
{
    static NSDictionary<NSString *, QTSubredditNamePrefixed *> *values;
    return values = values ? values : @{
        @"r/funny": [[QTSubredditNamePrefixed alloc] initWithValue:@"r/funny"],
    };
}

+ (QTSubredditNamePrefixed *)rFunny { return QTSubredditNamePrefixed.values[@"r/funny"]; }

+ (instancetype _Nullable)withValue:(NSString *)value
{
    return QTSubredditNamePrefixed.values[value];
}

- (instancetype)initWithValue:(NSString *)value
{
    if (self = [super init]) _value = value;
    return self;
}

- (NSUInteger)hash { return _value.hash; }
@end

@implementation QTSubredditType
+ (NSDictionary<NSString *, QTSubredditType *> *)values
{
    static NSDictionary<NSString *, QTSubredditType *> *values;
    return values = values ? values : @{
        @"public": [[QTSubredditType alloc] initWithValue:@"public"],
    };
}

+ (QTSubredditType *)public { return QTSubredditType.values[@"public"]; }

+ (instancetype _Nullable)withValue:(NSString *)value
{
    return QTSubredditType.values[value];
}

- (instancetype)initWithValue:(NSString *)value
{
    if (self = [super init]) _value = value;
    return self;
}

- (NSUInteger)hash { return _value.hash; }
@end

@implementation QTKind
+ (NSDictionary<NSString *, QTKind *> *)values
{
    static NSDictionary<NSString *, QTKind *> *values;
    return values = values ? values : @{
        @"t3": [[QTKind alloc] initWithValue:@"t3"],
    };
}

+ (QTKind *)t3 { return QTKind.values[@"t3"]; }

+ (instancetype _Nullable)withValue:(NSString *)value
{
    return QTKind.values[value];
}

- (instancetype)initWithValue:(NSString *)value
{
    if (self = [super init]) _value = value;
    return self;
}

- (NSUInteger)hash { return _value.hash; }
@end

static id map(id collection, id (^f)(id value)) {
    id result = nil;
    if ([collection isKindOfClass:[NSArray class]]) {
        result = [NSMutableArray arrayWithCapacity:[collection count]];
        for (id x in collection) [result addObject:f(x)];
    } else if ([collection isKindOfClass:[NSDictionary class]]) {
        result = [NSMutableDictionary dictionaryWithCapacity:[collection count]];
        for (id key in collection) [result setObject:f([collection objectForKey:key]) forKey:key];
    }
    return result;
}

// MARK: JSON serialization implementations

QTTopLevel *_Nullable QTTopLevelFromData(NSData *data, NSError **error)
{
    @try {
        id json = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingAllowFragments error:error];
        return *error ? nil : [QTTopLevel fromJSONDictionary:json];
    } @catch (NSException *exception) {
        *error = [NSError errorWithDomain:@"JSONSerialization" code:-1 userInfo:@{ @"exception": exception }];
        return nil;
    }
}

QTTopLevel *_Nullable QTTopLevelFromJSON(NSString *json, NSStringEncoding encoding, NSError **error)
{
    return QTTopLevelFromData([json dataUsingEncoding:encoding], error);
}

NSData *_Nullable QTTopLevelToData(QTTopLevel *topLevel, NSError **error)
{
    @try {
        id json = [topLevel JSONDictionary];
        NSData *data = [NSJSONSerialization dataWithJSONObject:json options:kNilOptions error:error];
        return *error ? nil : data;
    } @catch (NSException *exception) {
        *error = [NSError errorWithDomain:@"JSONSerialization" code:-1 userInfo:@{ @"exception": exception }];
        return nil;
    }
}

NSString *_Nullable QTTopLevelToJSON(QTTopLevel *topLevel, NSStringEncoding encoding, NSError **error)
{
    NSData *data = QTTopLevelToData(topLevel, error);
    return data ? [[NSString alloc] initWithData:data encoding:encoding] : nil;
}

@implementation QTTopLevel
+(NSDictionary<NSString *, NSString *> *)properties
{
    static NSDictionary<NSString *, NSString *> *properties;
    return properties = properties ? properties : @{
        @"kind": @"kind",
        @"data": @"data",
    };
}

+ (_Nullable instancetype)fromData:(NSData *)data error:(NSError *_Nullable *)error
{
    return QTTopLevelFromData(data, error);
}

+ (_Nullable instancetype)fromJSON:(NSString *)json encoding:(NSStringEncoding)encoding error:(NSError *_Nullable *)error
{
    return QTTopLevelFromJSON(json, encoding, error);
}

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict
{
    return dict ? [[QTTopLevel alloc] initWithJSONDictionary:dict] : nil;
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict
{
    if (self = [super init]) {
        [self setValuesForKeysWithDictionary:dict];
        _data = [QTTopLevelData fromJSONDictionary:(id)_data];
    }
    return self;
}

- (NSDictionary *)JSONDictionary
{
    id dict = [[self dictionaryWithValuesForKeys:QTTopLevel.properties.allValues] mutableCopy];

    // Map values that need translation
    [dict addEntriesFromDictionary:@{
        @"data": [_data JSONDictionary],
    }];

    return dict;
}

- (NSData *_Nullable)toData:(NSError *_Nullable *)error
{
    return QTTopLevelToData(self, error);
}

- (NSString *_Nullable)toJSON:(NSStringEncoding)encoding error:(NSError *_Nullable *)error
{
    return QTTopLevelToJSON(self, encoding, error);
}
@end

@implementation QTTopLevelData
+(NSDictionary<NSString *, NSString *> *)properties
{
    static NSDictionary<NSString *, NSString *> *properties;
    return properties = properties ? properties : @{
        @"modhash": @"modhash",
        @"children": @"children",
        @"after": @"after",
        @"before": @"before",
    };
}

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict
{
    return dict ? [[QTTopLevelData alloc] initWithJSONDictionary:dict] : nil;
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict
{
    if (self = [super init]) {
        [self setValuesForKeysWithDictionary:dict];
        _children = map(_children, λ(id x, [QTChild fromJSONDictionary:x]));
    }
    return self;
}

- (NSDictionary *)JSONDictionary
{
    id dict = [[self dictionaryWithValuesForKeys:QTTopLevelData.properties.allValues] mutableCopy];

    // Map values that need translation
    [dict addEntriesFromDictionary:@{
        @"children": map(_children, λ(id x, [x JSONDictionary])),
    }];

    return dict;
}
@end

@implementation QTChild
+(NSDictionary<NSString *, NSString *> *)properties
{
    static NSDictionary<NSString *, NSString *> *properties;
    return properties = properties ? properties : @{
        @"kind": @"kind",
        @"data": @"data",
    };
}

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict
{
    return dict ? [[QTChild alloc] initWithJSONDictionary:dict] : nil;
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict
{
    if (self = [super init]) {
        [self setValuesForKeysWithDictionary:dict];
        _kind = [QTKind withValue:(id)_kind];
        _data = [QTChildData fromJSONDictionary:(id)_data];
    }
    return self;
}

- (NSDictionary *)JSONDictionary
{
    id dict = [[self dictionaryWithValuesForKeys:QTChild.properties.allValues] mutableCopy];

    // Map values that need translation
    [dict addEntriesFromDictionary:@{
        @"kind": [_kind value],
        @"data": [_data JSONDictionary],
    }];

    return dict;
}
@end

@implementation QTChildData
+(NSDictionary<NSString *, NSString *> *)properties
{
    static NSDictionary<NSString *, NSString *> *properties;
    return properties = properties ? properties : @{
        @"domain": @"domain",
        @"approved_at_utc": @"approvedAtUTC",
        @"banned_by": @"bannedBy",
        @"media_embed": @"mediaEmbed",
        @"thumbnail_width": @"thumbnailWidth",
        @"subreddit": @"subreddit",
        @"selftext_html": @"selftextHTML",
        @"selftext": @"selftext",
        @"likes": @"likes",
        @"suggested_sort": @"suggestedSort",
        @"user_reports": @"userReports",
        @"secure_media": @"secureMedia",
        @"link_flair_text": @"linkFlairText",
        @"id": @"id",
        @"banned_at_utc": @"bannedAtUTC",
        @"view_count": @"viewCount",
        @"archived": @"archived",
        @"clicked": @"clicked",
        @"report_reasons": @"reportReasons",
        @"title": @"title",
        @"media": @"media",
        @"mod_reports": @"modReports",
        @"can_mod_post": @"canModPost",
        @"author_flair_text": @"authorFlairText",
        @"score": @"score",
        @"approved_by": @"approvedBy",
        @"over_18": @"over18",
        @"hidden": @"hidden",
        @"preview": @"preview",
        @"thumbnail": @"thumbnail",
        @"subreddit_id": @"subredditID",
        @"edited": @"edited",
        @"link_flair_css_class": @"linkFlairCSSClass",
        @"author_flair_css_class": @"authorFlairCSSClass",
        @"contest_mode": @"contestMode",
        @"gilded": @"gilded",
        @"downs": @"downs",
        @"brand_safe": @"brandSafe",
        @"secure_media_embed": @"secureMediaEmbed",
        @"saved": @"saved",
        @"removal_reason": @"removalReason",
        @"post_hint": @"postHint",
        @"stickied": @"stickied",
        @"can_gild": @"canGild",
        @"thumbnail_height": @"thumbnailHeight",
        @"parent_whitelist_status": @"parentWhitelistStatus",
        @"name": @"name",
        @"spoiler": @"spoiler",
        @"permalink": @"permalink",
        @"subreddit_type": @"subredditType",
        @"locked": @"locked",
        @"hide_score": @"hideScore",
        @"created": @"created",
        @"url": @"url",
        @"whitelist_status": @"whitelistStatus",
        @"quarantine": @"quarantine",
        @"author": @"author",
        @"created_utc": @"createdUTC",
        @"subreddit_name_prefixed": @"subredditNamePrefixed",
        @"ups": @"ups",
        @"num_comments": @"numComments",
        @"is_self": @"isSelf",
        @"visited": @"visited",
        @"num_reports": @"numReports",
        @"is_video": @"isVideo",
        @"distinguished": @"distinguished",
    };
}

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict
{
    return dict ? [[QTChildData alloc] initWithJSONDictionary:dict] : nil;
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict
{
    if (self = [super init]) {
        [self setValuesForKeysWithDictionary:dict];
        _domain = [QTDomain withValue:(id)_domain];
        _mediaEmbed = [QTMediaEmbed fromJSONDictionary:(id)_mediaEmbed];
        _subreddit = [QTSubreddit withValue:(id)_subreddit];
        _selftext = [QTSelftext withValue:(id)_selftext];
        _preview = [QTPreview fromJSONDictionary:(id)_preview];
        _subredditID = [QTSubredditID withValue:(id)_subredditID];
        _secureMediaEmbed = [QTMediaEmbed fromJSONDictionary:(id)_secureMediaEmbed];
        _postHint = [QTPostHint withValue:(id)_postHint];
        _parentWhitelistStatus = [QTWhitelistStatus withValue:(id)_parentWhitelistStatus];
        _subredditType = [QTSubredditType withValue:(id)_subredditType];
        _whitelistStatus = [QTWhitelistStatus withValue:(id)_whitelistStatus];
        _subredditNamePrefixed = [QTSubredditNamePrefixed withValue:(id)_subredditNamePrefixed];
    }
    return self;
}

-(void)setValue:(nullable id)value forKey:(NSString *)key
{
    [super setValue:value forKey:QTChildData.properties[key]];
}

- (NSDictionary *)JSONDictionary
{
    id dict = [[self dictionaryWithValuesForKeys:QTChildData.properties.allValues] mutableCopy];

    // Rewrite property names that differ in JSON
    for (id jsonName in QTChildData.properties) {
        id propertyName = QTChildData.properties[jsonName];
        if (![jsonName isEqualToString:propertyName]) {
            dict[jsonName] = dict[propertyName];
            [dict removeObjectForKey:propertyName];
        }
    }

    // Map values that need translation
    [dict addEntriesFromDictionary:@{
        @"domain": [_domain value],
        @"media_embed": [_mediaEmbed JSONDictionary],
        @"subreddit": [_subreddit value],
        @"selftext": [_selftext value],
        @"archived": _archived ? @YES : @NO,
        @"clicked": _clicked ? @YES : @NO,
        @"can_mod_post": _canModPost ? @YES : @NO,
        @"over_18": _over18 ? @YES : @NO,
        @"hidden": _hidden ? @YES : @NO,
        @"preview": [_preview JSONDictionary],
        @"subreddit_id": [_subredditID value],
        @"edited": _edited ? @YES : @NO,
        @"contest_mode": _contestMode ? @YES : @NO,
        @"brand_safe": _brandSafe ? @YES : @NO,
        @"secure_media_embed": [_secureMediaEmbed JSONDictionary],
        @"saved": _saved ? @YES : @NO,
        @"post_hint": [_postHint value],
        @"stickied": _stickied ? @YES : @NO,
        @"can_gild": _canGild ? @YES : @NO,
        @"parent_whitelist_status": [_parentWhitelistStatus value],
        @"spoiler": _spoiler ? @YES : @NO,
        @"subreddit_type": [_subredditType value],
        @"locked": _locked ? @YES : @NO,
        @"hide_score": _hideScore ? @YES : @NO,
        @"whitelist_status": [_whitelistStatus value],
        @"quarantine": _quarantine ? @YES : @NO,
        @"subreddit_name_prefixed": [_subredditNamePrefixed value],
        @"is_self": _isSelf ? @YES : @NO,
        @"visited": _visited ? @YES : @NO,
        @"is_video": _isVideo ? @YES : @NO,
    }];

    return dict;
}
@end

@implementation QTMediaEmbed
+(NSDictionary<NSString *, NSString *> *)properties
{
    static NSDictionary<NSString *, NSString *> *properties;
    return properties = properties ? properties : @{
    };
}

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict
{
    return dict ? [[QTMediaEmbed alloc] initWithJSONDictionary:dict] : nil;
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict
{
    if (self = [super init]) {
        [self setValuesForKeysWithDictionary:dict];
    }
    return self;
}

- (NSDictionary *)JSONDictionary
{
    return [self dictionaryWithValuesForKeys:QTMediaEmbed.properties.allValues];
}
@end

@implementation QTPreview
+(NSDictionary<NSString *, NSString *> *)properties
{
    static NSDictionary<NSString *, NSString *> *properties;
    return properties = properties ? properties : @{
        @"images": @"images",
        @"enabled": @"enabled",
    };
}

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict
{
    return dict ? [[QTPreview alloc] initWithJSONDictionary:dict] : nil;
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict
{
    if (self = [super init]) {
        [self setValuesForKeysWithDictionary:dict];
        _images = map(_images, λ(id x, [QTImage fromJSONDictionary:x]));
    }
    return self;
}

- (NSDictionary *)JSONDictionary
{
    id dict = [[self dictionaryWithValuesForKeys:QTPreview.properties.allValues] mutableCopy];

    // Map values that need translation
    [dict addEntriesFromDictionary:@{
        @"images": map(_images, λ(id x, [x JSONDictionary])),
        @"enabled": _enabled ? @YES : @NO,
    }];

    return dict;
}
@end

@implementation QTImage
+(NSDictionary<NSString *, NSString *> *)properties
{
    static NSDictionary<NSString *, NSString *> *properties;
    return properties = properties ? properties : @{
        @"source": @"source",
        @"resolutions": @"resolutions",
        @"variants": @"variants",
        @"id": @"id",
    };
}

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict
{
    return dict ? [[QTImage alloc] initWithJSONDictionary:dict] : nil;
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict
{
    if (self = [super init]) {
        [self setValuesForKeysWithDictionary:dict];
        _source = [QTResolution fromJSONDictionary:(id)_source];
        _resolutions = map(_resolutions, λ(id x, [QTResolution fromJSONDictionary:x]));
        _variants = [QTVariants fromJSONDictionary:(id)_variants];
    }
    return self;
}

- (NSDictionary *)JSONDictionary
{
    id dict = [[self dictionaryWithValuesForKeys:QTImage.properties.allValues] mutableCopy];

    // Map values that need translation
    [dict addEntriesFromDictionary:@{
        @"source": [_source JSONDictionary],
        @"resolutions": map(_resolutions, λ(id x, [x JSONDictionary])),
        @"variants": [_variants JSONDictionary],
    }];

    return dict;
}
@end

@implementation QTResolution
+(NSDictionary<NSString *, NSString *> *)properties
{
    static NSDictionary<NSString *, NSString *> *properties;
    return properties = properties ? properties : @{
        @"url": @"url",
        @"width": @"width",
        @"height": @"height",
    };
}

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict
{
    return dict ? [[QTResolution alloc] initWithJSONDictionary:dict] : nil;
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict
{
    if (self = [super init]) {
        [self setValuesForKeysWithDictionary:dict];
    }
    return self;
}

- (NSDictionary *)JSONDictionary
{
    return [self dictionaryWithValuesForKeys:QTResolution.properties.allValues];
}
@end

@implementation QTVariants
+(NSDictionary<NSString *, NSString *> *)properties
{
    static NSDictionary<NSString *, NSString *> *properties;
    return properties = properties ? properties : @{
        @"gif": @"gif",
        @"mp4": @"mp4",
    };
}

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict
{
    return dict ? [[QTVariants alloc] initWithJSONDictionary:dict] : nil;
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict
{
    if (self = [super init]) {
        [self setValuesForKeysWithDictionary:dict];
        _gif = [QTGIF fromJSONDictionary:(id)_gif];
        _mp4 = [QTGIF fromJSONDictionary:(id)_mp4];
    }
    return self;
}

- (NSDictionary *)JSONDictionary
{
    id dict = [[self dictionaryWithValuesForKeys:QTVariants.properties.allValues] mutableCopy];

    // Map values that need translation
    [dict addEntriesFromDictionary:@{
        @"gif": NSNullify([_gif JSONDictionary]),
        @"mp4": NSNullify([_mp4 JSONDictionary]),
    }];

    return dict;
}
@end

@implementation QTGIF
+(NSDictionary<NSString *, NSString *> *)properties
{
    static NSDictionary<NSString *, NSString *> *properties;
    return properties = properties ? properties : @{
        @"source": @"source",
        @"resolutions": @"resolutions",
    };
}

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict
{
    return dict ? [[QTGIF alloc] initWithJSONDictionary:dict] : nil;
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict
{
    if (self = [super init]) {
        [self setValuesForKeysWithDictionary:dict];
        _source = [QTResolution fromJSONDictionary:(id)_source];
        _resolutions = map(_resolutions, λ(id x, [QTResolution fromJSONDictionary:x]));
    }
    return self;
}

- (NSDictionary *)JSONDictionary
{
    id dict = [[self dictionaryWithValuesForKeys:QTGIF.properties.allValues] mutableCopy];

    // Map values that need translation
    [dict addEntriesFromDictionary:@{
        @"source": [_source JSONDictionary],
        @"resolutions": map(_resolutions, λ(id x, [x JSONDictionary])),
    }];

    return dict;
}
@end

NS_ASSUME_NONNULL_END

// To parse this JSON:
//
//   NSError *error;
//   QTTopLevel *topLevel = [QTTopLevel fromJSON:json encoding:NSUTF8Encoding error:&error]

#import <Foundation/Foundation.h>

@class QTTopLevel;
@class QTTopLevelData;
@class QTChild;
@class QTChildData;
@class QTDomain;
@class QTMediaEmbed;
@class QTWhitelistStatus;
@class QTPostHint;
@class QTPreview;
@class QTImage;
@class QTResolution;
@class QTVariants;
@class QTGIF;
@class QTSelftext;
@class QTSubreddit;
@class QTSubredditID;
@class QTSubredditNamePrefixed;
@class QTSubredditType;
@class QTKind;

NS_ASSUME_NONNULL_BEGIN

@interface QTDomain : NSObject
@property (nonatomic, readonly, copy) NSString *value;
+ (instancetype _Nullable)withValue:(NSString *)value;
+ (QTDomain *)iImgurCOM;
+ (QTDomain *)iReddIt;
+ (QTDomain *)imgurCOM;
+ (QTDomain *)redditCOM;
@end

@interface QTWhitelistStatus : NSObject
@property (nonatomic, readonly, copy) NSString *value;
+ (instancetype _Nullable)withValue:(NSString *)value;
+ (QTWhitelistStatus *)allAds;
@end

@interface QTPostHint : NSObject
@property (nonatomic, readonly, copy) NSString *value;
+ (instancetype _Nullable)withValue:(NSString *)value;
+ (QTPostHint *)image;
+ (QTPostHint *)link;
@end

@interface QTSelftext : NSObject
@property (nonatomic, readonly, copy) NSString *value;
+ (instancetype _Nullable)withValue:(NSString *)value;
+ (QTSelftext *)empty;
@end

@interface QTSubreddit : NSObject
@property (nonatomic, readonly, copy) NSString *value;
+ (instancetype _Nullable)withValue:(NSString *)value;
+ (QTSubreddit *)funny;
@end

@interface QTSubredditID : NSObject
@property (nonatomic, readonly, copy) NSString *value;
+ (instancetype _Nullable)withValue:(NSString *)value;
+ (QTSubredditID *)t52Qh33;
@end

@interface QTSubredditNamePrefixed : NSObject
@property (nonatomic, readonly, copy) NSString *value;
+ (instancetype _Nullable)withValue:(NSString *)value;
+ (QTSubredditNamePrefixed *)rFunny;
@end

@interface QTSubredditType : NSObject
@property (nonatomic, readonly, copy) NSString *value;
+ (instancetype _Nullable)withValue:(NSString *)value;
+ (QTSubredditType *)public;
@end

@interface QTKind : NSObject
@property (nonatomic, readonly, copy) NSString *value;
+ (instancetype _Nullable)withValue:(NSString *)value;
+ (QTKind *)t3;
@end

// Marshalling functions for top-level types.

QTTopLevel *QTTopLevelFromData(NSData *data, NSError **error);
QTTopLevel *QTTopLevelFromJSON(NSString *json, NSStringEncoding encoding, NSError **error);
NSData     *QTTopLevelToData(QTTopLevel *topLevel, NSError **error);
NSString   *QTTopLevelToJSON(QTTopLevel *topLevel, NSStringEncoding encoding, NSError **error);

@interface QTTopLevel : NSObject
@property (nonatomic) NSString *kind;
@property (nonatomic) QTTopLevelData *data;

+ (_Nullable instancetype)fromJSON:(NSString *)json encoding:(NSStringEncoding)encoding error:(NSError *_Nullable *)error;
+ (_Nullable instancetype)fromData:(NSData *)data error:(NSError *_Nullable *)error;
- (NSString *_Nullable)toJSON:(NSStringEncoding)encoding error:(NSError *_Nullable *)error;
- (NSData *_Nullable)toData:(NSError *_Nullable *)error;
@end

@interface QTTopLevelData : NSObject
@property (nonatomic) NSString *modhash;
@property (nonatomic) NSArray<QTChild *> *children;
@property (nonatomic) NSString *after;
@property (nonatomic, nullable) id before;
@end

@interface QTChild : NSObject
@property (nonatomic) QTKind *kind;
@property (nonatomic) QTChildData *data;
@end

@interface QTChildData : NSObject
@property (nonatomic) QTDomain *domain;
@property (nonatomic, nullable) id approvedAtUTC;
@property (nonatomic, nullable) id bannedBy;
@property (nonatomic) QTMediaEmbed *mediaEmbed;
@property (nonatomic) NSInteger thumbnailWidth;
@property (nonatomic) QTSubreddit *subreddit;
@property (nonatomic, nullable) id selftextHTML;
@property (nonatomic) QTSelftext *selftext;
@property (nonatomic, nullable) id likes;
@property (nonatomic, nullable) id suggestedSort;
@property (nonatomic) NSArray *userReports;
@property (nonatomic, nullable) id secureMedia;
@property (nonatomic, nullable) NSString *linkFlairText;
@property (nonatomic) NSString *id;
@property (nonatomic, nullable) id bannedAtUTC;
@property (nonatomic, nullable) id viewCount;
@property (nonatomic) BOOL archived;
@property (nonatomic) BOOL clicked;
@property (nonatomic, nullable) id reportReasons;
@property (nonatomic) NSString *title;
@property (nonatomic, nullable) id media;
@property (nonatomic) NSArray *modReports;
@property (nonatomic) BOOL canModPost;
@property (nonatomic, nullable) NSString *authorFlairText;
@property (nonatomic) NSInteger score;
@property (nonatomic, nullable) id approvedBy;
@property (nonatomic) BOOL over18;
@property (nonatomic) BOOL hidden;
@property (nonatomic) QTPreview *preview;
@property (nonatomic) NSString *thumbnail;
@property (nonatomic) QTSubredditID *subredditID;
@property (nonatomic) BOOL edited;
@property (nonatomic, nullable) NSString *linkFlairCSSClass;
@property (nonatomic, nullable) NSString *authorFlairCSSClass;
@property (nonatomic) BOOL contestMode;
@property (nonatomic) NSInteger gilded;
@property (nonatomic) NSInteger downs;
@property (nonatomic) BOOL brandSafe;
@property (nonatomic) QTMediaEmbed *secureMediaEmbed;
@property (nonatomic) BOOL saved;
@property (nonatomic, nullable) id removalReason;
@property (nonatomic) QTPostHint *postHint;
@property (nonatomic) BOOL stickied;
@property (nonatomic) BOOL canGild;
@property (nonatomic) NSInteger thumbnailHeight;
@property (nonatomic) QTWhitelistStatus *parentWhitelistStatus;
@property (nonatomic) NSString *name;
@property (nonatomic) BOOL spoiler;
@property (nonatomic) NSString *permalink;
@property (nonatomic) QTSubredditType *subredditType;
@property (nonatomic) BOOL locked;
@property (nonatomic) BOOL hideScore;
@property (nonatomic) NSInteger created;
@property (nonatomic) NSString *url;
@property (nonatomic) QTWhitelistStatus *whitelistStatus;
@property (nonatomic) BOOL quarantine;
@property (nonatomic) NSString *author;
@property (nonatomic) NSInteger createdUTC;
@property (nonatomic) QTSubredditNamePrefixed *subredditNamePrefixed;
@property (nonatomic) NSInteger ups;
@property (nonatomic) NSInteger numComments;
@property (nonatomic) BOOL isSelf;
@property (nonatomic) BOOL visited;
@property (nonatomic, nullable) id numReports;
@property (nonatomic) BOOL isVideo;
@property (nonatomic, nullable) NSString *distinguished;
@end

@interface QTMediaEmbed : NSObject
@end

@interface QTPreview : NSObject
@property (nonatomic) NSArray<QTImage *> *images;
@property (nonatomic) BOOL enabled;
@end

@interface QTImage : NSObject
@property (nonatomic) QTResolution *source;
@property (nonatomic) NSArray<QTResolution *> *resolutions;
@property (nonatomic) QTVariants *variants;
@property (nonatomic) NSString *id;
@end

@interface QTResolution : NSObject
@property (nonatomic) NSString *url;
@property (nonatomic) NSInteger width;
@property (nonatomic) NSInteger height;
@end

@interface QTVariants : NSObject
@property (nonatomic, nullable) QTGIF *gif;
@property (nonatomic, nullable) QTGIF *mp4;
@end

@interface QTGIF : NSObject
@property (nonatomic) QTResolution *source;
@property (nonatomic) NSArray<QTResolution *> *resolutions;
@end

NS_ASSUME_NONNULL_END

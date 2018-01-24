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

QTTopLevel *_Nullable QTTopLevelFromData(NSData *data, NSError **error);
QTTopLevel *_Nullable QTTopLevelFromJSON(NSString *json, NSStringEncoding encoding, NSError **error);
NSData     *_Nullable QTTopLevelToData(QTTopLevel *topLevel, NSError **error);
NSString   *_Nullable QTTopLevelToJSON(QTTopLevel *topLevel, NSStringEncoding encoding, NSError **error);

@interface QTTopLevel : NSObject
@property (nonatomic, copy) NSString *kind;
@property (nonatomic, retain) QTTopLevelData *data;

+ (_Nullable instancetype)fromJSON:(NSString *)json encoding:(NSStringEncoding)encoding error:(NSError *_Nullable *)error;
+ (_Nullable instancetype)fromData:(NSData *)data error:(NSError *_Nullable *)error;
- (NSString *_Nullable)toJSON:(NSStringEncoding)encoding error:(NSError *_Nullable *)error;
- (NSData *_Nullable)toData:(NSError *_Nullable *)error;
@end

@interface QTTopLevelData : NSObject
@property (nonatomic, copy) NSString *modhash;
@property (nonatomic, assign) NSArray<QTChild *> *children;
@property (nonatomic, copy) NSString *after;
@property (nonatomic, nullable, copy) id before;
@end

@interface QTChild : NSObject
@property (nonatomic, copy) QTKind *kind;
@property (nonatomic, retain) QTChildData *data;
@end

@interface QTChildData : NSObject
@property (nonatomic, copy) QTDomain *domain;
@property (nonatomic, nullable, copy) id approvedAtUTC;
@property (nonatomic, nullable, copy) id bannedBy;
@property (nonatomic, retain) QTMediaEmbed *mediaEmbed;
@property (nonatomic, assign) NSInteger thumbnailWidth;
@property (nonatomic, copy) QTSubreddit *subreddit;
@property (nonatomic, nullable, copy) id selftextHTML;
@property (nonatomic, copy) QTSelftext *selftext;
@property (nonatomic, nullable, copy) id likes;
@property (nonatomic, nullable, copy) id suggestedSort;
@property (nonatomic, assign) NSArray *userReports;
@property (nonatomic, nullable, copy) id secureMedia;
@property (nonatomic, nullable, copy) NSString *linkFlairText;
@property (nonatomic, copy) NSString *id;
@property (nonatomic, nullable, copy) id bannedAtUTC;
@property (nonatomic, nullable, copy) id viewCount;
@property (nonatomic, assign) BOOL archived;
@property (nonatomic, assign) BOOL clicked;
@property (nonatomic, nullable, copy) id reportReasons;
@property (nonatomic, copy) NSString *title;
@property (nonatomic, nullable, copy) id media;
@property (nonatomic, assign) NSArray *modReports;
@property (nonatomic, assign) BOOL canModPost;
@property (nonatomic, nullable, copy) NSString *authorFlairText;
@property (nonatomic, assign) NSInteger score;
@property (nonatomic, nullable, copy) id approvedBy;
@property (nonatomic, assign) BOOL over18;
@property (nonatomic, assign) BOOL hidden;
@property (nonatomic, retain) QTPreview *preview;
@property (nonatomic, copy) NSString *thumbnail;
@property (nonatomic, copy) QTSubredditID *subredditID;
@property (nonatomic, assign) BOOL edited;
@property (nonatomic, nullable, copy) NSString *linkFlairCSSClass;
@property (nonatomic, nullable, copy) NSString *authorFlairCSSClass;
@property (nonatomic, assign) BOOL contestMode;
@property (nonatomic, assign) NSInteger gilded;
@property (nonatomic, assign) NSInteger downs;
@property (nonatomic, assign) BOOL brandSafe;
@property (nonatomic, retain) QTMediaEmbed *secureMediaEmbed;
@property (nonatomic, assign) BOOL saved;
@property (nonatomic, nullable, copy) id removalReason;
@property (nonatomic, copy) QTPostHint *postHint;
@property (nonatomic, assign) BOOL stickied;
@property (nonatomic, assign) BOOL canGild;
@property (nonatomic, assign) NSInteger thumbnailHeight;
@property (nonatomic, copy) QTWhitelistStatus *parentWhitelistStatus;
@property (nonatomic, copy) NSString *name;
@property (nonatomic, assign) BOOL spoiler;
@property (nonatomic, copy) NSString *permalink;
@property (nonatomic, copy) QTSubredditType *subredditType;
@property (nonatomic, assign) BOOL locked;
@property (nonatomic, assign) BOOL hideScore;
@property (nonatomic, assign) NSInteger created;
@property (nonatomic, copy) NSString *url;
@property (nonatomic, copy) QTWhitelistStatus *whitelistStatus;
@property (nonatomic, assign) BOOL quarantine;
@property (nonatomic, copy) NSString *author;
@property (nonatomic, assign) NSInteger createdUTC;
@property (nonatomic, copy) QTSubredditNamePrefixed *subredditNamePrefixed;
@property (nonatomic, assign) NSInteger ups;
@property (nonatomic, assign) NSInteger numComments;
@property (nonatomic, assign) BOOL isSelf;
@property (nonatomic, assign) BOOL visited;
@property (nonatomic, nullable, copy) id numReports;
@property (nonatomic, assign) BOOL isVideo;
@property (nonatomic, nullable, copy) NSString *distinguished;
@end

@interface QTMediaEmbed : NSObject
@end

@interface QTPreview : NSObject
@property (nonatomic, assign) NSArray<QTImage *> *images;
@property (nonatomic, assign) BOOL enabled;
@end

@interface QTImage : NSObject
@property (nonatomic, retain) QTResolution *source;
@property (nonatomic, assign) NSArray<QTResolution *> *resolutions;
@property (nonatomic, retain) QTVariants *variants;
@property (nonatomic, copy) NSString *id;
@end

@interface QTResolution : NSObject
@property (nonatomic, copy) NSString *url;
@property (nonatomic, assign) NSInteger width;
@property (nonatomic, assign) NSInteger height;
@end

@interface QTVariants : NSObject
@property (nonatomic, nullable, copy) QTGIF *gif;
@property (nonatomic, nullable, copy) QTGIF *mp4;
@end

@interface QTGIF : NSObject
@property (nonatomic, retain) QTResolution *source;
@property (nonatomic, assign) NSArray<QTResolution *> *resolutions;
@end

NS_ASSUME_NONNULL_END

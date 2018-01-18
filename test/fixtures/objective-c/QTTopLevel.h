// To parse this JSON:
//
//   NSError *error;
//   QTTopLevel *topLevel = QTTopLevelFromJSON(json, NSUTF8Encoding, &error);

#import <Foundation/Foundation.h>

// MARK: Types

typedef NSNumber NSBoolean;

@class QTPurpleTopLevel;
@class QTActor;
@class QTGravatarID;
@class QTPayload;
@class QTComment;
@class QTUser;
@class QTType;
@class QTCommit;
@class QTAuthor;
@class QTIssue;
@class QTLabel;
@class QTMilestone;
@class QTIssuePullRequest;
@class QTPayloadPullRequest;
@class QTBase;
@class QTBaseRepo;
@class QTLinks;
@class QTComments;
@class QTTopLevelRepo;

NS_ASSUME_NONNULL_BEGIN

@interface QTGravatarID : NSObject
@property (nonatomic, readonly, copy) NSString *value;
+ (instancetype _Nullable)withValue:(NSString *)value;
+ (QTGravatarID *)empty;
@end

@interface QTType : NSObject
@property (nonatomic, readonly, copy) NSString *value;
+ (instancetype _Nullable)withValue:(NSString *)value;
+ (QTType *)organization;
+ (QTType *)user;
@end

typedef NSArray<QTPurpleTopLevel *> QTTopLevel;

// MARK: Top-level marshalling functions

QTTopLevel *QTTopLevelFromData(NSData *data, NSError **error);
QTTopLevel *QTTopLevelFromJSON(NSString *json, NSStringEncoding encoding, NSError **error);
NSData *QTTopLevelToData(QTTopLevel *topLevel, NSError **error);
NSString *QTTopLevelToJSON(QTTopLevel *topLevel, NSStringEncoding encoding, NSError **error);

@interface QTPurpleTopLevel : NSObject
@property (nonatomic) NSString *id;
@property (nonatomic) NSString *type;
@property (nonatomic) QTActor *actor;
@property (nonatomic) QTTopLevelRepo *repo;
@property (nonatomic) QTPayload *payload;
@property (nonatomic) NSBoolean *public;
@property (nonatomic) NSString *createdAt;
@property (nonatomic, nullable) QTActor *org;
@end

@interface QTActor : NSObject
@property (nonatomic) NSNumber *id;
@property (nonatomic) NSString *login;
@property (nonatomic, nullable) NSString *displayLogin;
@property (nonatomic) QTGravatarID *gravatarID;
@property (nonatomic) NSString *url;
@property (nonatomic) NSString *avatarURL;
@end

@interface QTPayload : NSObject
@property (nonatomic, nullable) NSNumber *pushID;
@property (nonatomic, nullable) NSNumber *size;
@property (nonatomic, nullable) NSNumber *distinctSize;
@property (nonatomic, nullable) NSString *ref;
@property (nonatomic, nullable) NSString *head;
@property (nonatomic, nullable) NSString *before;
@property (nonatomic, nullable) NSArray<QTCommit *> *commits;
@property (nonatomic, nullable) NSString *action;
@property (nonatomic, nullable) QTIssue *issue;
@property (nonatomic, nullable) QTComment *comment;
@property (nonatomic, nullable) NSString *refType;
@property (nonatomic, nullable) NSString *masterBranch;
@property (nonatomic, nullable) NSString *description;
@property (nonatomic, nullable) NSString *pusherType;
@property (nonatomic, nullable) NSNumber *number;
@property (nonatomic, nullable) QTPayloadPullRequest *pullRequest;
@end

@interface QTComment : NSObject
@property (nonatomic) NSString *url;
@property (nonatomic) NSString *htmlURL;
@property (nonatomic) NSString *issueURL;
@property (nonatomic) NSNumber *id;
@property (nonatomic) QTUser *user;
@property (nonatomic) NSString *createdAt;
@property (nonatomic) NSString *updatedAt;
@property (nonatomic) NSString *body;
@end

@interface QTUser : NSObject
@property (nonatomic) NSString *login;
@property (nonatomic) NSNumber *id;
@property (nonatomic) NSString *avatarURL;
@property (nonatomic) QTGravatarID *gravatarID;
@property (nonatomic) NSString *url;
@property (nonatomic) NSString *htmlURL;
@property (nonatomic) NSString *followersURL;
@property (nonatomic) NSString *followingURL;
@property (nonatomic) NSString *gistsURL;
@property (nonatomic) NSString *starredURL;
@property (nonatomic) NSString *subscriptionsURL;
@property (nonatomic) NSString *organizationsURL;
@property (nonatomic) NSString *reposURL;
@property (nonatomic) NSString *eventsURL;
@property (nonatomic) NSString *receivedEventsURL;
@property (nonatomic) QTType *type;
@property (nonatomic) NSBoolean *siteAdmin;
@end

@interface QTCommit : NSObject
@property (nonatomic) NSString *sha;
@property (nonatomic) QTAuthor *author;
@property (nonatomic) NSString *message;
@property (nonatomic) NSBoolean *distinct;
@property (nonatomic) NSString *url;
@end

@interface QTAuthor : NSObject
@property (nonatomic) NSString *email;
@property (nonatomic) NSString *name;
@end

@interface QTIssue : NSObject
@property (nonatomic) NSString *url;
@property (nonatomic) NSString *repositoryURL;
@property (nonatomic) NSString *labelsURL;
@property (nonatomic) NSString *commentsURL;
@property (nonatomic) NSString *eventsURL;
@property (nonatomic) NSString *htmlURL;
@property (nonatomic) NSNumber *id;
@property (nonatomic) NSNumber *number;
@property (nonatomic) NSString *title;
@property (nonatomic) QTUser *user;
@property (nonatomic) NSArray<QTLabel *> *labels;
@property (nonatomic) NSString *state;
@property (nonatomic) NSBoolean *locked;
@property (nonatomic, nullable) id assignee;
@property (nonatomic) NSArray *assignees;
@property (nonatomic, nullable) QTMilestone *milestone;
@property (nonatomic) NSNumber *comments;
@property (nonatomic) NSString *createdAt;
@property (nonatomic) NSString *updatedAt;
@property (nonatomic, nullable) NSString *closedAt;
@property (nonatomic) NSString *body;
@property (nonatomic, nullable) QTIssuePullRequest *pullRequest;
@end

@interface QTLabel : NSObject
@property (nonatomic) NSNumber *id;
@property (nonatomic) NSString *url;
@property (nonatomic) NSString *name;
@property (nonatomic) NSString *color;
@property (nonatomic) NSBoolean *theDefault;
@end

@interface QTMilestone : NSObject
@property (nonatomic) NSString *url;
@property (nonatomic) NSString *htmlURL;
@property (nonatomic) NSString *labelsURL;
@property (nonatomic) NSNumber *id;
@property (nonatomic) NSNumber *number;
@property (nonatomic) NSString *title;
@property (nonatomic) NSString *description;
@property (nonatomic) QTUser *creator;
@property (nonatomic) NSNumber *openIssues;
@property (nonatomic) NSNumber *closedIssues;
@property (nonatomic) NSString *state;
@property (nonatomic) NSString *createdAt;
@property (nonatomic) NSString *updatedAt;
@property (nonatomic, nullable) NSString *dueOn;
@property (nonatomic, nullable) id closedAt;
@end

@interface QTIssuePullRequest : NSObject
@property (nonatomic) NSString *url;
@property (nonatomic) NSString *htmlURL;
@property (nonatomic) NSString *diffURL;
@property (nonatomic) NSString *patchURL;
@end

@interface QTPayloadPullRequest : NSObject
@property (nonatomic) NSString *url;
@property (nonatomic) NSNumber *id;
@property (nonatomic) NSString *htmlURL;
@property (nonatomic) NSString *diffURL;
@property (nonatomic) NSString *patchURL;
@property (nonatomic) NSString *issueURL;
@property (nonatomic) NSNumber *number;
@property (nonatomic) NSString *state;
@property (nonatomic) NSBoolean *locked;
@property (nonatomic) NSString *title;
@property (nonatomic) QTUser *user;
@property (nonatomic) NSString *body;
@property (nonatomic) NSString *createdAt;
@property (nonatomic) NSString *updatedAt;
@property (nonatomic) NSString *closedAt;
@property (nonatomic) NSString *mergedAt;
@property (nonatomic) NSString *mergeCommitSHA;
@property (nonatomic, nullable) id assignee;
@property (nonatomic) NSArray *assignees;
@property (nonatomic) NSArray *requestedReviewers;
@property (nonatomic, nullable) id milestone;
@property (nonatomic) NSString *commitsURL;
@property (nonatomic) NSString *reviewCommentsURL;
@property (nonatomic) NSString *reviewCommentURL;
@property (nonatomic) NSString *commentsURL;
@property (nonatomic) NSString *statusesURL;
@property (nonatomic) QTBase *head;
@property (nonatomic) QTBase *base;
@property (nonatomic) QTLinks *links;
@property (nonatomic) NSBoolean *merged;
@property (nonatomic, nullable) id mergeable;
@property (nonatomic, nullable) id rebaseable;
@property (nonatomic) NSString *mergeableState;
@property (nonatomic) QTUser *mergedBy;
@property (nonatomic) NSNumber *comments;
@property (nonatomic) NSNumber *reviewComments;
@property (nonatomic) NSBoolean *maintainerCanModify;
@property (nonatomic) NSNumber *commits;
@property (nonatomic) NSNumber *additions;
@property (nonatomic) NSNumber *deletions;
@property (nonatomic) NSNumber *changedFiles;
@end

@interface QTBase : NSObject
@property (nonatomic) NSString *label;
@property (nonatomic) NSString *ref;
@property (nonatomic) NSString *sha;
@property (nonatomic) QTUser *user;
@property (nonatomic) QTBaseRepo *repo;
@end

@interface QTBaseRepo : NSObject
@property (nonatomic) NSNumber *id;
@property (nonatomic) NSString *name;
@property (nonatomic) NSString *fullName;
@property (nonatomic) QTUser *owner;
@property (nonatomic) NSBoolean *private;
@property (nonatomic) NSString *htmlURL;
@property (nonatomic) NSString *description;
@property (nonatomic) NSBoolean *fork;
@property (nonatomic) NSString *url;
@property (nonatomic) NSString *forksURL;
@property (nonatomic) NSString *keysURL;
@property (nonatomic) NSString *collaboratorsURL;
@property (nonatomic) NSString *teamsURL;
@property (nonatomic) NSString *hooksURL;
@property (nonatomic) NSString *issueEventsURL;
@property (nonatomic) NSString *eventsURL;
@property (nonatomic) NSString *assigneesURL;
@property (nonatomic) NSString *branchesURL;
@property (nonatomic) NSString *tagsURL;
@property (nonatomic) NSString *blobsURL;
@property (nonatomic) NSString *gitTagsURL;
@property (nonatomic) NSString *gitRefsURL;
@property (nonatomic) NSString *treesURL;
@property (nonatomic) NSString *statusesURL;
@property (nonatomic) NSString *languagesURL;
@property (nonatomic) NSString *stargazersURL;
@property (nonatomic) NSString *contributorsURL;
@property (nonatomic) NSString *subscribersURL;
@property (nonatomic) NSString *subscriptionURL;
@property (nonatomic) NSString *commitsURL;
@property (nonatomic) NSString *gitCommitsURL;
@property (nonatomic) NSString *commentsURL;
@property (nonatomic) NSString *issueCommentURL;
@property (nonatomic) NSString *contentsURL;
@property (nonatomic) NSString *compareURL;
@property (nonatomic) NSString *mergesURL;
@property (nonatomic) NSString *archiveURL;
@property (nonatomic) NSString *downloadsURL;
@property (nonatomic) NSString *issuesURL;
@property (nonatomic) NSString *pullsURL;
@property (nonatomic) NSString *milestonesURL;
@property (nonatomic) NSString *notificationsURL;
@property (nonatomic) NSString *labelsURL;
@property (nonatomic) NSString *releasesURL;
@property (nonatomic) NSString *deploymentsURL;
@property (nonatomic) NSString *createdAt;
@property (nonatomic) NSString *updatedAt;
@property (nonatomic) NSString *pushedAt;
@property (nonatomic) NSString *gitURL;
@property (nonatomic) NSString *sshURL;
@property (nonatomic) NSString *cloneURL;
@property (nonatomic) NSString *svnURL;
@property (nonatomic) NSString *homepage;
@property (nonatomic) NSNumber *size;
@property (nonatomic) NSNumber *stargazersCount;
@property (nonatomic) NSNumber *watchersCount;
@property (nonatomic) NSString *language;
@property (nonatomic) NSBoolean *hasIssues;
@property (nonatomic) NSBoolean *hasProjects;
@property (nonatomic) NSBoolean *hasDownloads;
@property (nonatomic) NSBoolean *hasWiki;
@property (nonatomic) NSBoolean *hasPages;
@property (nonatomic) NSNumber *forksCount;
@property (nonatomic, nullable) id mirrorURL;
@property (nonatomic) NSNumber *openIssuesCount;
@property (nonatomic) NSNumber *forks;
@property (nonatomic) NSNumber *openIssues;
@property (nonatomic) NSNumber *watchers;
@property (nonatomic) NSString *defaultBranch;
@end

@interface QTLinks : NSObject
@property (nonatomic) QTComments *self;
@property (nonatomic) QTComments *html;
@property (nonatomic) QTComments *issue;
@property (nonatomic) QTComments *comments;
@property (nonatomic) QTComments *reviewComments;
@property (nonatomic) QTComments *reviewComment;
@property (nonatomic) QTComments *commits;
@property (nonatomic) QTComments *statuses;
@end

@interface QTComments : NSObject
@property (nonatomic) NSString *href;
@end

@interface QTTopLevelRepo : NSObject
@property (nonatomic) NSNumber *id;
@property (nonatomic) NSString *name;
@property (nonatomic) NSString *url;
@end

NS_ASSUME_NONNULL_END

// MARK: Implementation

#define λ(decl, expr) (^(decl) { return (expr); })
#define NSNullify(x) ([x isNotEqualTo:[NSNull null]] ? x : [NSNull null])

id _Nonnull NOT_NIL(id _Nullable x) {
    if (nil == x) @throw [NSException exceptionWithName:@"UnexpectedNil" reason:nil userInfo:nil];
    return x;
}

NS_ASSUME_NONNULL_BEGIN

@implementation NSArray (JSONConversion)
- (NSArray *)map:(id (^)(id element))f {
    id result = [NSMutableArray arrayWithCapacity:self.count];
    for (id x in self) [result addObject:f(x)];
    return result;
}
@end

@implementation NSDictionary (JSONConversion)
- (NSDictionary *)map:(id (^)(id value))f {
    id result = [NSMutableDictionary dictionaryWithCapacity:self.count];
    for (id key in self) [result setObject:f([self objectForKey:key]) forKey:key];
    return result;
}

- (NSException *)exceptionForKey:(id)key type:(NSString *)type {
    return [NSException exceptionWithName:@"TypeException"
                                   reason:[NSString stringWithFormat:@"Expected a %@", type]
                                 userInfo:@{ @"dictionary":self, @"key":key }];
}

- (id)objectForKey:(NSString *)key withClass:(Class)cls {
    id value = [self objectForKey:key];
    if ([value isKindOfClass:cls]) return value;
    else @throw [self exceptionForKey:key type:NSStringFromClass(cls)];
}

- (NSBoolean *)boolForKey:(NSString *)key {
    id value = [self objectForKey:key];
    if ([value isEqual:@(YES)] || [value isEqual:@(NO)]) return value;
    else @throw [self exceptionForKey:key type:@"bool"];
}
@end

@interface QTPurpleTopLevel (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTActor (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTPayload (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTComment (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTUser (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTCommit (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTAuthor (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTIssue (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTLabel (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTMilestone (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTIssuePullRequest (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTPayloadPullRequest (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTBase (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTBaseRepo (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTLinks (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTComments (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTTopLevelRepo (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

// MARK: Pseudo-enum implementations

@implementation QTGravatarID

static NSMutableDictionary<NSString *, QTGravatarID *> *qtGravatarIDS;
@synthesize value;

+ (QTGravatarID *)empty { return qtGravatarIDS[@""]; }

+ (void)initialize
{
    NSArray<NSString *> *values = @[
                                    @"",
                                    ];
    qtGravatarIDS = [NSMutableDictionary dictionaryWithCapacity:values.count];
    for (NSString *value in values) qtGravatarIDS[value] = [[QTGravatarID alloc] initWithValue:value];
}

+ (instancetype _Nullable)withValue:(NSString *)value { return qtGravatarIDS[value]; }

- (instancetype)initWithValue:(NSString *)val
{
    if (self = [super init]) value = val;
    return self;
}

- (NSUInteger)hash { return value.hash; }
@end

@implementation QTType

static NSMutableDictionary<NSString *, QTType *> *qtTypes;
@synthesize value;

+ (QTType *)organization { return qtTypes[@"Organization"]; }
+ (QTType *)user { return qtTypes[@"User"]; }

+ (void)initialize
{
    NSArray<NSString *> *values = @[
                                    @"Organization",
                                    @"User",
                                    ];
    qtTypes = [NSMutableDictionary dictionaryWithCapacity:values.count];
    for (NSString *value in values) qtTypes[value] = [[QTType alloc] initWithValue:value];
}

+ (instancetype _Nullable)withValue:(NSString *)value { return qtTypes[value]; }

- (instancetype)initWithValue:(NSString *)val
{
    if (self = [super init]) value = val;
    return self;
}

- (NSUInteger)hash { return value.hash; }
@end

// MARK: JSON serialization implementations

QTTopLevel *QTTopLevelFromData(NSData *data, NSError **error) {
    NSArray *json = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingAllowFragments error:error];
    return *error ? nil : [json map:λ(id x, [QTPurpleTopLevel fromJSONDictionary:x])];
}

QTTopLevel *QTTopLevelFromJSON(NSString *json, NSStringEncoding encoding, NSError **error) {
    return QTTopLevelFromData([json dataUsingEncoding:encoding], error);
}

NSData *QTTopLevelToData(QTTopLevel *topLevel, NSError **error) {
    NSArray *json = [topLevel map:λ(id x, [x JSONDictionary])];
    NSData *data = [NSJSONSerialization dataWithJSONObject:json options:kNilOptions error:error];
    return *error ? nil : data;
}

NSString *QTTopLevelToJSON(QTTopLevel *topLevel, NSStringEncoding encoding, NSError **error) {
    NSData *data = QTTopLevelToData(topLevel, error);
    return data ? [[NSString alloc] initWithData:data encoding:encoding] : nil;
}

@implementation QTPurpleTopLevel
@synthesize id, type, actor, repo, payload;
@synthesize public, createdAt, org;

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict {
    return [[QTPurpleTopLevel alloc] initWithJSONDictionary:dict];
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict {
    if (self = [super init]) {
        self.id = [dict objectForKey:@"id" withClass:[NSString class]];
        type = [dict objectForKey:@"type" withClass:[NSString class]];
        actor = [QTActor fromJSONDictionary:[dict objectForKey:@"actor" withClass:[NSDictionary class]]];
        repo = [QTTopLevelRepo fromJSONDictionary:[dict objectForKey:@"repo" withClass:[NSDictionary class]]];
        payload = [QTPayload fromJSONDictionary:[dict objectForKey:@"payload" withClass:[NSDictionary class]]];
        public = [dict boolForKey:@"public"];
        createdAt = [dict objectForKey:@"created_at" withClass:[NSString class]];
        
        if ([[dict objectForKey:@"org"] isNotEqualTo:[NSNull null]]) {
            org = [QTActor fromJSONDictionary:[dict objectForKey:@"org" withClass:[NSDictionary class]]];
        }
        
    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
             @"id": self.id,
             @"type": type,
             @"actor": [actor JSONDictionary],
             @"repo": [repo JSONDictionary],
             @"payload": [payload JSONDictionary],
             @"public": public,
             @"created_at": createdAt,
             @"org": NSNullify([org JSONDictionary]),
             };
}
@end

@implementation QTActor
@synthesize id, login, displayLogin, gravatarID, url;
@synthesize avatarURL;

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict {
    return [[QTActor alloc] initWithJSONDictionary:dict];
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict {
    if (self = [super init]) {
        self.id = [dict objectForKey:@"id" withClass:[NSNumber class]];
        login = [dict objectForKey:@"login" withClass:[NSString class]];
        
        if ([[dict objectForKey:@"display_login"] isNotEqualTo:[NSNull null]]) {
            displayLogin = [dict objectForKey:@"display_login" withClass:[NSString class]];
        }
        
        gravatarID = NOT_NIL([QTGravatarID withValue:[dict objectForKey:@"gravatar_id" withClass:[NSString class]]]);
        url = [dict objectForKey:@"url" withClass:[NSString class]];
        avatarURL = [dict objectForKey:@"avatar_url" withClass:[NSString class]];
    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
             @"id": self.id,
             @"login": login,
             @"display_login": NSNullify(displayLogin),
             @"gravatar_id": [gravatarID value],
             @"url": url,
             @"avatar_url": avatarURL,
             };
}
@end

@implementation QTPayload
@synthesize pushID, size, distinctSize, ref, head;
@synthesize before, commits, action, issue, comment;
@synthesize refType, masterBranch, description, pusherType, number;
@synthesize pullRequest;

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict {
    return [[QTPayload alloc] initWithJSONDictionary:dict];
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict {
    if (self = [super init]) {
        
        if ([[dict objectForKey:@"push_id"] isNotEqualTo:[NSNull null]]) {
            pushID = [dict objectForKey:@"push_id" withClass:[NSNumber class]];
        }
        
        if ([[dict objectForKey:@"size"] isNotEqualTo:[NSNull null]]) {
            size = [dict objectForKey:@"size" withClass:[NSNumber class]];
        }
        
        if ([[dict objectForKey:@"distinct_size"] isNotEqualTo:[NSNull null]]) {
            distinctSize = [dict objectForKey:@"distinct_size" withClass:[NSNumber class]];
        }
        
        if ([[dict objectForKey:@"ref"] isNotEqualTo:[NSNull null]]) {
            ref = [dict objectForKey:@"ref" withClass:[NSString class]];
        }
        
        if ([[dict objectForKey:@"head"] isNotEqualTo:[NSNull null]]) {
            head = [dict objectForKey:@"head" withClass:[NSString class]];
        }
        
        if ([[dict objectForKey:@"before"] isNotEqualTo:[NSNull null]]) {
            before = [dict objectForKey:@"before" withClass:[NSString class]];
        }
        
        if ([[dict objectForKey:@"commits"] isNotEqualTo:[NSNull null]]) {
            commits = [[dict objectForKey:@"commits" withClass:[NSArray class]] map:λ(id x, [QTCommit fromJSONDictionary:x])];
        }
        
        if ([[dict objectForKey:@"action"] isNotEqualTo:[NSNull null]]) {
            action = [dict objectForKey:@"action" withClass:[NSString class]];
        }
        
        if ([[dict objectForKey:@"issue"] isNotEqualTo:[NSNull null]]) {
            issue = [QTIssue fromJSONDictionary:[dict objectForKey:@"issue" withClass:[NSDictionary class]]];
        }
        
        if ([[dict objectForKey:@"comment"] isNotEqualTo:[NSNull null]]) {
            comment = [QTComment fromJSONDictionary:[dict objectForKey:@"comment" withClass:[NSDictionary class]]];
        }
        
        if ([[dict objectForKey:@"ref_type"] isNotEqualTo:[NSNull null]]) {
            refType = [dict objectForKey:@"ref_type" withClass:[NSString class]];
        }
        
        if ([[dict objectForKey:@"master_branch"] isNotEqualTo:[NSNull null]]) {
            masterBranch = [dict objectForKey:@"master_branch" withClass:[NSString class]];
        }
        
        if ([[dict objectForKey:@"description"] isNotEqualTo:[NSNull null]]) {
            description = [dict objectForKey:@"description" withClass:[NSString class]];
        }
        
        if ([[dict objectForKey:@"pusher_type"] isNotEqualTo:[NSNull null]]) {
            pusherType = [dict objectForKey:@"pusher_type" withClass:[NSString class]];
        }
        
        if ([[dict objectForKey:@"number"] isNotEqualTo:[NSNull null]]) {
            number = [dict objectForKey:@"number" withClass:[NSNumber class]];
        }
        
        if ([[dict objectForKey:@"pull_request"] isNotEqualTo:[NSNull null]]) {
            pullRequest = [QTPayloadPullRequest fromJSONDictionary:[dict objectForKey:@"pull_request" withClass:[NSDictionary class]]];
        }
        
    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
             @"push_id": NSNullify(pushID),
             @"size": NSNullify(size),
             @"distinct_size": NSNullify(distinctSize),
             @"ref": NSNullify(ref),
             @"head": NSNullify(head),
             @"before": NSNullify(before),
             @"commits": NSNullify([commits map:λ(id x, [x JSONDictionary])]),
             @"action": NSNullify(action),
             @"issue": NSNullify([issue JSONDictionary]),
             @"comment": NSNullify([comment JSONDictionary]),
             @"ref_type": NSNullify(refType),
             @"master_branch": NSNullify(masterBranch),
             @"description": NSNullify(description),
             @"pusher_type": NSNullify(pusherType),
             @"number": NSNullify(number),
             @"pull_request": NSNullify([pullRequest JSONDictionary]),
             };
}
@end

@implementation QTComment
@synthesize url, htmlURL, issueURL, id, user;
@synthesize createdAt, updatedAt, body;

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict {
    return [[QTComment alloc] initWithJSONDictionary:dict];
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict {
    if (self = [super init]) {
        url = [dict objectForKey:@"url" withClass:[NSString class]];
        htmlURL = [dict objectForKey:@"html_url" withClass:[NSString class]];
        issueURL = [dict objectForKey:@"issue_url" withClass:[NSString class]];
        self.id = [dict objectForKey:@"id" withClass:[NSNumber class]];
        user = [QTUser fromJSONDictionary:[dict objectForKey:@"user" withClass:[NSDictionary class]]];
        createdAt = [dict objectForKey:@"created_at" withClass:[NSString class]];
        updatedAt = [dict objectForKey:@"updated_at" withClass:[NSString class]];
        body = [dict objectForKey:@"body" withClass:[NSString class]];
    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
             @"url": url,
             @"html_url": htmlURL,
             @"issue_url": issueURL,
             @"id": self.id,
             @"user": [user JSONDictionary],
             @"created_at": createdAt,
             @"updated_at": updatedAt,
             @"body": body,
             };
}
@end

@implementation QTUser
@synthesize login, id, avatarURL, gravatarID, url;
@synthesize htmlURL, followersURL, followingURL, gistsURL, starredURL;
@synthesize subscriptionsURL, organizationsURL, reposURL, eventsURL, receivedEventsURL;
@synthesize type, siteAdmin;

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict {
    return [[QTUser alloc] initWithJSONDictionary:dict];
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict {
    if (self = [super init]) {
        login = [dict objectForKey:@"login" withClass:[NSString class]];
        self.id = [dict objectForKey:@"id" withClass:[NSNumber class]];
        avatarURL = [dict objectForKey:@"avatar_url" withClass:[NSString class]];
        gravatarID = NOT_NIL([QTGravatarID withValue:[dict objectForKey:@"gravatar_id" withClass:[NSString class]]]);
        url = [dict objectForKey:@"url" withClass:[NSString class]];
        htmlURL = [dict objectForKey:@"html_url" withClass:[NSString class]];
        followersURL = [dict objectForKey:@"followers_url" withClass:[NSString class]];
        followingURL = [dict objectForKey:@"following_url" withClass:[NSString class]];
        gistsURL = [dict objectForKey:@"gists_url" withClass:[NSString class]];
        starredURL = [dict objectForKey:@"starred_url" withClass:[NSString class]];
        subscriptionsURL = [dict objectForKey:@"subscriptions_url" withClass:[NSString class]];
        organizationsURL = [dict objectForKey:@"organizations_url" withClass:[NSString class]];
        reposURL = [dict objectForKey:@"repos_url" withClass:[NSString class]];
        eventsURL = [dict objectForKey:@"events_url" withClass:[NSString class]];
        receivedEventsURL = [dict objectForKey:@"received_events_url" withClass:[NSString class]];
        type = NOT_NIL([QTType withValue:[dict objectForKey:@"type" withClass:[NSString class]]]);
        siteAdmin = [dict boolForKey:@"site_admin"];
    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
             @"login": login,
             @"id": self.id,
             @"avatar_url": avatarURL,
             @"gravatar_id": [gravatarID value],
             @"url": url,
             @"html_url": htmlURL,
             @"followers_url": followersURL,
             @"following_url": followingURL,
             @"gists_url": gistsURL,
             @"starred_url": starredURL,
             @"subscriptions_url": subscriptionsURL,
             @"organizations_url": organizationsURL,
             @"repos_url": reposURL,
             @"events_url": eventsURL,
             @"received_events_url": receivedEventsURL,
             @"type": [type value],
             @"site_admin": siteAdmin,
             };
}
@end

@implementation QTCommit
@synthesize sha, author, message, distinct, url;

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict {
    return [[QTCommit alloc] initWithJSONDictionary:dict];
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict {
    if (self = [super init]) {
        sha = [dict objectForKey:@"sha" withClass:[NSString class]];
        author = [QTAuthor fromJSONDictionary:[dict objectForKey:@"author" withClass:[NSDictionary class]]];
        message = [dict objectForKey:@"message" withClass:[NSString class]];
        distinct = [dict boolForKey:@"distinct"];
        url = [dict objectForKey:@"url" withClass:[NSString class]];
    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
             @"sha": sha,
             @"author": [author JSONDictionary],
             @"message": message,
             @"distinct": distinct,
             @"url": url,
             };
}
@end

@implementation QTAuthor
@synthesize email, name;

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict {
    return [[QTAuthor alloc] initWithJSONDictionary:dict];
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict {
    if (self = [super init]) {
        email = [dict objectForKey:@"email" withClass:[NSString class]];
        name = [dict objectForKey:@"name" withClass:[NSString class]];
    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
             @"email": email,
             @"name": name,
             };
}
@end

@implementation QTIssue
@synthesize url, repositoryURL, labelsURL, commentsURL, eventsURL;
@synthesize htmlURL, id, number, title, user;
@synthesize labels, state, locked, assignee, assignees;
@synthesize milestone, comments, createdAt, updatedAt, closedAt;
@synthesize body, pullRequest;

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict {
    return [[QTIssue alloc] initWithJSONDictionary:dict];
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict {
    if (self = [super init]) {
        url = [dict objectForKey:@"url" withClass:[NSString class]];
        repositoryURL = [dict objectForKey:@"repository_url" withClass:[NSString class]];
        labelsURL = [dict objectForKey:@"labels_url" withClass:[NSString class]];
        commentsURL = [dict objectForKey:@"comments_url" withClass:[NSString class]];
        eventsURL = [dict objectForKey:@"events_url" withClass:[NSString class]];
        htmlURL = [dict objectForKey:@"html_url" withClass:[NSString class]];
        self.id = [dict objectForKey:@"id" withClass:[NSNumber class]];
        number = [dict objectForKey:@"number" withClass:[NSNumber class]];
        title = [dict objectForKey:@"title" withClass:[NSString class]];
        user = [QTUser fromJSONDictionary:[dict objectForKey:@"user" withClass:[NSDictionary class]]];
        labels = [[dict objectForKey:@"labels" withClass:[NSArray class]] map:λ(id x, [QTLabel fromJSONDictionary:x])];
        state = [dict objectForKey:@"state" withClass:[NSString class]];
        locked = [dict boolForKey:@"locked"];
        assignee = [dict objectForKey:@"assignee" withClass:[NSNull class]];
        assignees = [[dict objectForKey:@"assignees" withClass:[NSArray class]] map:λ(id x, x)];
        
        if ([[dict objectForKey:@"milestone"] isNotEqualTo:[NSNull null]]) {
            milestone = [QTMilestone fromJSONDictionary:[dict objectForKey:@"milestone" withClass:[NSDictionary class]]];
        }
        
        comments = [dict objectForKey:@"comments" withClass:[NSNumber class]];
        createdAt = [dict objectForKey:@"created_at" withClass:[NSString class]];
        updatedAt = [dict objectForKey:@"updated_at" withClass:[NSString class]];
        
        if ([[dict objectForKey:@"closed_at"] isNotEqualTo:[NSNull null]]) {
            closedAt = [dict objectForKey:@"closed_at" withClass:[NSString class]];
        }
        
        body = [dict objectForKey:@"body" withClass:[NSString class]];
        
        if ([[dict objectForKey:@"pull_request"] isNotEqualTo:[NSNull null]]) {
            pullRequest = [QTIssuePullRequest fromJSONDictionary:[dict objectForKey:@"pull_request" withClass:[NSDictionary class]]];
        }
        
    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
             @"url": url,
             @"repository_url": repositoryURL,
             @"labels_url": labelsURL,
             @"comments_url": commentsURL,
             @"events_url": eventsURL,
             @"html_url": htmlURL,
             @"id": self.id,
             @"number": number,
             @"title": title,
             @"user": [user JSONDictionary],
             @"labels": [labels map:λ(id x, [x JSONDictionary])],
             @"state": state,
             @"locked": locked,
             @"assignee": NSNullify(assignee),
             @"assignees": assignees,
             @"milestone": NSNullify([milestone JSONDictionary]),
             @"comments": comments,
             @"created_at": createdAt,
             @"updated_at": updatedAt,
             @"closed_at": NSNullify(closedAt),
             @"body": body,
             @"pull_request": NSNullify([pullRequest JSONDictionary]),
             };
}
@end

@implementation QTLabel
@synthesize id, url, name, color, theDefault;

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict {
    return [[QTLabel alloc] initWithJSONDictionary:dict];
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict {
    if (self = [super init]) {
        self.id = [dict objectForKey:@"id" withClass:[NSNumber class]];
        url = [dict objectForKey:@"url" withClass:[NSString class]];
        name = [dict objectForKey:@"name" withClass:[NSString class]];
        color = [dict objectForKey:@"color" withClass:[NSString class]];
        theDefault = [dict boolForKey:@"default"];
    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
             @"id": self.id,
             @"url": url,
             @"name": name,
             @"color": color,
             @"default": theDefault,
             };
}
@end

@implementation QTMilestone
@synthesize url, htmlURL, labelsURL, id, number;
@synthesize title, description, creator, openIssues, closedIssues;
@synthesize state, createdAt, updatedAt, dueOn, closedAt;

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict {
    return [[QTMilestone alloc] initWithJSONDictionary:dict];
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict {
    if (self = [super init]) {
        url = [dict objectForKey:@"url" withClass:[NSString class]];
        htmlURL = [dict objectForKey:@"html_url" withClass:[NSString class]];
        labelsURL = [dict objectForKey:@"labels_url" withClass:[NSString class]];
        self.id = [dict objectForKey:@"id" withClass:[NSNumber class]];
        number = [dict objectForKey:@"number" withClass:[NSNumber class]];
        title = [dict objectForKey:@"title" withClass:[NSString class]];
        description = [dict objectForKey:@"description" withClass:[NSString class]];
        creator = [QTUser fromJSONDictionary:[dict objectForKey:@"creator" withClass:[NSDictionary class]]];
        openIssues = [dict objectForKey:@"open_issues" withClass:[NSNumber class]];
        closedIssues = [dict objectForKey:@"closed_issues" withClass:[NSNumber class]];
        state = [dict objectForKey:@"state" withClass:[NSString class]];
        createdAt = [dict objectForKey:@"created_at" withClass:[NSString class]];
        updatedAt = [dict objectForKey:@"updated_at" withClass:[NSString class]];
        
        if ([[dict objectForKey:@"due_on"] isNotEqualTo:[NSNull null]]) {
            dueOn = [dict objectForKey:@"due_on" withClass:[NSString class]];
        }
        
        closedAt = [dict objectForKey:@"closed_at" withClass:[NSNull class]];
    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
             @"url": url,
             @"html_url": htmlURL,
             @"labels_url": labelsURL,
             @"id": self.id,
             @"number": number,
             @"title": title,
             @"description": description,
             @"creator": [creator JSONDictionary],
             @"open_issues": openIssues,
             @"closed_issues": closedIssues,
             @"state": state,
             @"created_at": createdAt,
             @"updated_at": updatedAt,
             @"due_on": NSNullify(dueOn),
             @"closed_at": NSNullify(closedAt),
             };
}
@end

@implementation QTIssuePullRequest
@synthesize url, htmlURL, diffURL, patchURL;

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict {
    return [[QTIssuePullRequest alloc] initWithJSONDictionary:dict];
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict {
    if (self = [super init]) {
        url = [dict objectForKey:@"url" withClass:[NSString class]];
        htmlURL = [dict objectForKey:@"html_url" withClass:[NSString class]];
        diffURL = [dict objectForKey:@"diff_url" withClass:[NSString class]];
        patchURL = [dict objectForKey:@"patch_url" withClass:[NSString class]];
    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
             @"url": url,
             @"html_url": htmlURL,
             @"diff_url": diffURL,
             @"patch_url": patchURL,
             };
}
@end

@implementation QTPayloadPullRequest
@synthesize url, id, htmlURL, diffURL, patchURL;
@synthesize issueURL, number, state, locked, title;
@synthesize user, body, createdAt, updatedAt, closedAt;
@synthesize mergedAt, mergeCommitSHA, assignee, assignees, requestedReviewers;
@synthesize milestone, commitsURL, reviewCommentsURL, reviewCommentURL, commentsURL;
@synthesize statusesURL, head, base, links, merged;
@synthesize mergeable, rebaseable, mergeableState, mergedBy, comments;
@synthesize reviewComments, maintainerCanModify, commits, additions, deletions;
@synthesize changedFiles;

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict {
    return [[QTPayloadPullRequest alloc] initWithJSONDictionary:dict];
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict {
    if (self = [super init]) {
        url = [dict objectForKey:@"url" withClass:[NSString class]];
        self.id = [dict objectForKey:@"id" withClass:[NSNumber class]];
        htmlURL = [dict objectForKey:@"html_url" withClass:[NSString class]];
        diffURL = [dict objectForKey:@"diff_url" withClass:[NSString class]];
        patchURL = [dict objectForKey:@"patch_url" withClass:[NSString class]];
        issueURL = [dict objectForKey:@"issue_url" withClass:[NSString class]];
        number = [dict objectForKey:@"number" withClass:[NSNumber class]];
        state = [dict objectForKey:@"state" withClass:[NSString class]];
        locked = [dict boolForKey:@"locked"];
        title = [dict objectForKey:@"title" withClass:[NSString class]];
        user = [QTUser fromJSONDictionary:[dict objectForKey:@"user" withClass:[NSDictionary class]]];
        body = [dict objectForKey:@"body" withClass:[NSString class]];
        createdAt = [dict objectForKey:@"created_at" withClass:[NSString class]];
        updatedAt = [dict objectForKey:@"updated_at" withClass:[NSString class]];
        closedAt = [dict objectForKey:@"closed_at" withClass:[NSString class]];
        mergedAt = [dict objectForKey:@"merged_at" withClass:[NSString class]];
        mergeCommitSHA = [dict objectForKey:@"merge_commit_sha" withClass:[NSString class]];
        assignee = [dict objectForKey:@"assignee" withClass:[NSNull class]];
        assignees = [[dict objectForKey:@"assignees" withClass:[NSArray class]] map:λ(id x, x)];
        requestedReviewers = [[dict objectForKey:@"requested_reviewers" withClass:[NSArray class]] map:λ(id x, x)];
        milestone = [dict objectForKey:@"milestone" withClass:[NSNull class]];
        commitsURL = [dict objectForKey:@"commits_url" withClass:[NSString class]];
        reviewCommentsURL = [dict objectForKey:@"review_comments_url" withClass:[NSString class]];
        reviewCommentURL = [dict objectForKey:@"review_comment_url" withClass:[NSString class]];
        commentsURL = [dict objectForKey:@"comments_url" withClass:[NSString class]];
        statusesURL = [dict objectForKey:@"statuses_url" withClass:[NSString class]];
        head = [QTBase fromJSONDictionary:[dict objectForKey:@"head" withClass:[NSDictionary class]]];
        base = [QTBase fromJSONDictionary:[dict objectForKey:@"base" withClass:[NSDictionary class]]];
        links = [QTLinks fromJSONDictionary:[dict objectForKey:@"_links" withClass:[NSDictionary class]]];
        merged = [dict boolForKey:@"merged"];
        mergeable = [dict objectForKey:@"mergeable" withClass:[NSNull class]];
        rebaseable = [dict objectForKey:@"rebaseable" withClass:[NSNull class]];
        mergeableState = [dict objectForKey:@"mergeable_state" withClass:[NSString class]];
        mergedBy = [QTUser fromJSONDictionary:[dict objectForKey:@"merged_by" withClass:[NSDictionary class]]];
        comments = [dict objectForKey:@"comments" withClass:[NSNumber class]];
        reviewComments = [dict objectForKey:@"review_comments" withClass:[NSNumber class]];
        maintainerCanModify = [dict boolForKey:@"maintainer_can_modify"];
        commits = [dict objectForKey:@"commits" withClass:[NSNumber class]];
        additions = [dict objectForKey:@"additions" withClass:[NSNumber class]];
        deletions = [dict objectForKey:@"deletions" withClass:[NSNumber class]];
        changedFiles = [dict objectForKey:@"changed_files" withClass:[NSNumber class]];
    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
             @"url": url,
             @"id": self.id,
             @"html_url": htmlURL,
             @"diff_url": diffURL,
             @"patch_url": patchURL,
             @"issue_url": issueURL,
             @"number": number,
             @"state": state,
             @"locked": locked,
             @"title": title,
             @"user": [user JSONDictionary],
             @"body": body,
             @"created_at": createdAt,
             @"updated_at": updatedAt,
             @"closed_at": closedAt,
             @"merged_at": mergedAt,
             @"merge_commit_sha": mergeCommitSHA,
             @"assignee": NSNullify(assignee),
             @"assignees": assignees,
             @"requested_reviewers": requestedReviewers,
             @"milestone": NSNullify(milestone),
             @"commits_url": commitsURL,
             @"review_comments_url": reviewCommentsURL,
             @"review_comment_url": reviewCommentURL,
             @"comments_url": commentsURL,
             @"statuses_url": statusesURL,
             @"head": [head JSONDictionary],
             @"base": [base JSONDictionary],
             @"_links": [links JSONDictionary],
             @"merged": merged,
             @"mergeable": NSNullify(mergeable),
             @"rebaseable": NSNullify(rebaseable),
             @"mergeable_state": mergeableState,
             @"merged_by": [mergedBy JSONDictionary],
             @"comments": comments,
             @"review_comments": reviewComments,
             @"maintainer_can_modify": maintainerCanModify,
             @"commits": commits,
             @"additions": additions,
             @"deletions": deletions,
             @"changed_files": changedFiles,
             };
}
@end

@implementation QTBase
@synthesize label, ref, sha, user, repo;

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict {
    return [[QTBase alloc] initWithJSONDictionary:dict];
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict {
    if (self = [super init]) {
        label = [dict objectForKey:@"label" withClass:[NSString class]];
        ref = [dict objectForKey:@"ref" withClass:[NSString class]];
        sha = [dict objectForKey:@"sha" withClass:[NSString class]];
        user = [QTUser fromJSONDictionary:[dict objectForKey:@"user" withClass:[NSDictionary class]]];
        repo = [QTBaseRepo fromJSONDictionary:[dict objectForKey:@"repo" withClass:[NSDictionary class]]];
    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
             @"label": label,
             @"ref": ref,
             @"sha": sha,
             @"user": [user JSONDictionary],
             @"repo": [repo JSONDictionary],
             };
}
@end

@implementation QTBaseRepo
@synthesize id, name, fullName, owner, private;
@synthesize htmlURL, description, fork, url, forksURL;
@synthesize keysURL, collaboratorsURL, teamsURL, hooksURL, issueEventsURL;
@synthesize eventsURL, assigneesURL, branchesURL, tagsURL, blobsURL;
@synthesize gitTagsURL, gitRefsURL, treesURL, statusesURL, languagesURL;
@synthesize stargazersURL, contributorsURL, subscribersURL, subscriptionURL, commitsURL;
@synthesize gitCommitsURL, commentsURL, issueCommentURL, contentsURL, compareURL;
@synthesize mergesURL, archiveURL, downloadsURL, issuesURL, pullsURL;
@synthesize milestonesURL, notificationsURL, labelsURL, releasesURL, deploymentsURL;
@synthesize createdAt, updatedAt, pushedAt, gitURL, sshURL;
@synthesize cloneURL, svnURL, homepage, size, stargazersCount;
@synthesize watchersCount, language, hasIssues, hasProjects, hasDownloads;
@synthesize hasWiki, hasPages, forksCount, mirrorURL, openIssuesCount;
@synthesize forks, openIssues, watchers, defaultBranch;

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict {
    return [[QTBaseRepo alloc] initWithJSONDictionary:dict];
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict {
    if (self = [super init]) {
        self.id = [dict objectForKey:@"id" withClass:[NSNumber class]];
        name = [dict objectForKey:@"name" withClass:[NSString class]];
        fullName = [dict objectForKey:@"full_name" withClass:[NSString class]];
        owner = [QTUser fromJSONDictionary:[dict objectForKey:@"owner" withClass:[NSDictionary class]]];
        private = [dict boolForKey:@"private"];
        htmlURL = [dict objectForKey:@"html_url" withClass:[NSString class]];
        description = [dict objectForKey:@"description" withClass:[NSString class]];
        fork = [dict boolForKey:@"fork"];
        url = [dict objectForKey:@"url" withClass:[NSString class]];
        forksURL = [dict objectForKey:@"forks_url" withClass:[NSString class]];
        keysURL = [dict objectForKey:@"keys_url" withClass:[NSString class]];
        collaboratorsURL = [dict objectForKey:@"collaborators_url" withClass:[NSString class]];
        teamsURL = [dict objectForKey:@"teams_url" withClass:[NSString class]];
        hooksURL = [dict objectForKey:@"hooks_url" withClass:[NSString class]];
        issueEventsURL = [dict objectForKey:@"issue_events_url" withClass:[NSString class]];
        eventsURL = [dict objectForKey:@"events_url" withClass:[NSString class]];
        assigneesURL = [dict objectForKey:@"assignees_url" withClass:[NSString class]];
        branchesURL = [dict objectForKey:@"branches_url" withClass:[NSString class]];
        tagsURL = [dict objectForKey:@"tags_url" withClass:[NSString class]];
        blobsURL = [dict objectForKey:@"blobs_url" withClass:[NSString class]];
        gitTagsURL = [dict objectForKey:@"git_tags_url" withClass:[NSString class]];
        gitRefsURL = [dict objectForKey:@"git_refs_url" withClass:[NSString class]];
        treesURL = [dict objectForKey:@"trees_url" withClass:[NSString class]];
        statusesURL = [dict objectForKey:@"statuses_url" withClass:[NSString class]];
        languagesURL = [dict objectForKey:@"languages_url" withClass:[NSString class]];
        stargazersURL = [dict objectForKey:@"stargazers_url" withClass:[NSString class]];
        contributorsURL = [dict objectForKey:@"contributors_url" withClass:[NSString class]];
        subscribersURL = [dict objectForKey:@"subscribers_url" withClass:[NSString class]];
        subscriptionURL = [dict objectForKey:@"subscription_url" withClass:[NSString class]];
        commitsURL = [dict objectForKey:@"commits_url" withClass:[NSString class]];
        gitCommitsURL = [dict objectForKey:@"git_commits_url" withClass:[NSString class]];
        commentsURL = [dict objectForKey:@"comments_url" withClass:[NSString class]];
        issueCommentURL = [dict objectForKey:@"issue_comment_url" withClass:[NSString class]];
        contentsURL = [dict objectForKey:@"contents_url" withClass:[NSString class]];
        compareURL = [dict objectForKey:@"compare_url" withClass:[NSString class]];
        mergesURL = [dict objectForKey:@"merges_url" withClass:[NSString class]];
        archiveURL = [dict objectForKey:@"archive_url" withClass:[NSString class]];
        downloadsURL = [dict objectForKey:@"downloads_url" withClass:[NSString class]];
        issuesURL = [dict objectForKey:@"issues_url" withClass:[NSString class]];
        pullsURL = [dict objectForKey:@"pulls_url" withClass:[NSString class]];
        milestonesURL = [dict objectForKey:@"milestones_url" withClass:[NSString class]];
        notificationsURL = [dict objectForKey:@"notifications_url" withClass:[NSString class]];
        labelsURL = [dict objectForKey:@"labels_url" withClass:[NSString class]];
        releasesURL = [dict objectForKey:@"releases_url" withClass:[NSString class]];
        deploymentsURL = [dict objectForKey:@"deployments_url" withClass:[NSString class]];
        createdAt = [dict objectForKey:@"created_at" withClass:[NSString class]];
        updatedAt = [dict objectForKey:@"updated_at" withClass:[NSString class]];
        pushedAt = [dict objectForKey:@"pushed_at" withClass:[NSString class]];
        gitURL = [dict objectForKey:@"git_url" withClass:[NSString class]];
        sshURL = [dict objectForKey:@"ssh_url" withClass:[NSString class]];
        cloneURL = [dict objectForKey:@"clone_url" withClass:[NSString class]];
        svnURL = [dict objectForKey:@"svn_url" withClass:[NSString class]];
        homepage = [dict objectForKey:@"homepage" withClass:[NSString class]];
        size = [dict objectForKey:@"size" withClass:[NSNumber class]];
        stargazersCount = [dict objectForKey:@"stargazers_count" withClass:[NSNumber class]];
        watchersCount = [dict objectForKey:@"watchers_count" withClass:[NSNumber class]];
        language = [dict objectForKey:@"language" withClass:[NSString class]];
        hasIssues = [dict boolForKey:@"has_issues"];
        hasProjects = [dict boolForKey:@"has_projects"];
        hasDownloads = [dict boolForKey:@"has_downloads"];
        hasWiki = [dict boolForKey:@"has_wiki"];
        hasPages = [dict boolForKey:@"has_pages"];
        forksCount = [dict objectForKey:@"forks_count" withClass:[NSNumber class]];
        mirrorURL = [dict objectForKey:@"mirror_url" withClass:[NSNull class]];
        openIssuesCount = [dict objectForKey:@"open_issues_count" withClass:[NSNumber class]];
        forks = [dict objectForKey:@"forks" withClass:[NSNumber class]];
        openIssues = [dict objectForKey:@"open_issues" withClass:[NSNumber class]];
        watchers = [dict objectForKey:@"watchers" withClass:[NSNumber class]];
        defaultBranch = [dict objectForKey:@"default_branch" withClass:[NSString class]];
    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
             @"id": self.id,
             @"name": name,
             @"full_name": fullName,
             @"owner": [owner JSONDictionary],
             @"private": private,
             @"html_url": htmlURL,
             @"description": description,
             @"fork": fork,
             @"url": url,
             @"forks_url": forksURL,
             @"keys_url": keysURL,
             @"collaborators_url": collaboratorsURL,
             @"teams_url": teamsURL,
             @"hooks_url": hooksURL,
             @"issue_events_url": issueEventsURL,
             @"events_url": eventsURL,
             @"assignees_url": assigneesURL,
             @"branches_url": branchesURL,
             @"tags_url": tagsURL,
             @"blobs_url": blobsURL,
             @"git_tags_url": gitTagsURL,
             @"git_refs_url": gitRefsURL,
             @"trees_url": treesURL,
             @"statuses_url": statusesURL,
             @"languages_url": languagesURL,
             @"stargazers_url": stargazersURL,
             @"contributors_url": contributorsURL,
             @"subscribers_url": subscribersURL,
             @"subscription_url": subscriptionURL,
             @"commits_url": commitsURL,
             @"git_commits_url": gitCommitsURL,
             @"comments_url": commentsURL,
             @"issue_comment_url": issueCommentURL,
             @"contents_url": contentsURL,
             @"compare_url": compareURL,
             @"merges_url": mergesURL,
             @"archive_url": archiveURL,
             @"downloads_url": downloadsURL,
             @"issues_url": issuesURL,
             @"pulls_url": pullsURL,
             @"milestones_url": milestonesURL,
             @"notifications_url": notificationsURL,
             @"labels_url": labelsURL,
             @"releases_url": releasesURL,
             @"deployments_url": deploymentsURL,
             @"created_at": createdAt,
             @"updated_at": updatedAt,
             @"pushed_at": pushedAt,
             @"git_url": gitURL,
             @"ssh_url": sshURL,
             @"clone_url": cloneURL,
             @"svn_url": svnURL,
             @"homepage": homepage,
             @"size": size,
             @"stargazers_count": stargazersCount,
             @"watchers_count": watchersCount,
             @"language": language,
             @"has_issues": hasIssues,
             @"has_projects": hasProjects,
             @"has_downloads": hasDownloads,
             @"has_wiki": hasWiki,
             @"has_pages": hasPages,
             @"forks_count": forksCount,
             @"mirror_url": NSNullify(mirrorURL),
             @"open_issues_count": openIssuesCount,
             @"forks": forks,
             @"open_issues": openIssues,
             @"watchers": watchers,
             @"default_branch": defaultBranch,
             };
}
@end

@implementation QTLinks
@synthesize self, html, issue, comments, reviewComments;
@synthesize reviewComment, commits, statuses;

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict {
    return [[QTLinks alloc] initWithJSONDictionary:dict];
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict {
    if (self = [super init]) {
        self.self = [QTComments fromJSONDictionary:[dict objectForKey:@"self" withClass:[NSDictionary class]]];
        html = [QTComments fromJSONDictionary:[dict objectForKey:@"html" withClass:[NSDictionary class]]];
        issue = [QTComments fromJSONDictionary:[dict objectForKey:@"issue" withClass:[NSDictionary class]]];
        comments = [QTComments fromJSONDictionary:[dict objectForKey:@"comments" withClass:[NSDictionary class]]];
        reviewComments = [QTComments fromJSONDictionary:[dict objectForKey:@"review_comments" withClass:[NSDictionary class]]];
        reviewComment = [QTComments fromJSONDictionary:[dict objectForKey:@"review_comment" withClass:[NSDictionary class]]];
        commits = [QTComments fromJSONDictionary:[dict objectForKey:@"commits" withClass:[NSDictionary class]]];
        statuses = [QTComments fromJSONDictionary:[dict objectForKey:@"statuses" withClass:[NSDictionary class]]];
    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
             @"self": [self.self JSONDictionary],
             @"html": [html JSONDictionary],
             @"issue": [issue JSONDictionary],
             @"comments": [comments JSONDictionary],
             @"review_comments": [reviewComments JSONDictionary],
             @"review_comment": [reviewComment JSONDictionary],
             @"commits": [commits JSONDictionary],
             @"statuses": [statuses JSONDictionary],
             };
}
@end

@implementation QTComments
@synthesize href;

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict {
    return [[QTComments alloc] initWithJSONDictionary:dict];
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict {
    if (self = [super init]) {
        href = [dict objectForKey:@"href" withClass:[NSString class]];
    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
             @"href": href,
             };
}
@end

@implementation QTTopLevelRepo
@synthesize id, name, url;

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict {
    return [[QTTopLevelRepo alloc] initWithJSONDictionary:dict];
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict {
    if (self = [super init]) {
        self.id = [dict objectForKey:@"id" withClass:[NSNumber class]];
        name = [dict objectForKey:@"name" withClass:[NSString class]];
        url = [dict objectForKey:@"url" withClass:[NSString class]];
    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
             @"id": self.id,
             @"name": name,
             @"url": url,
             };
}
@end

NS_ASSUME_NONNULL_END


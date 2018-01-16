// To parse this JSON:
//
//   NSError *error;
//   QTTopLevel *topLevel = QTTopLevelFromJSON(json, NSUTF8Encoding, &error);

#import <Foundation/Foundation.h>

// MARK: Types

typedef NSNumber NSBoolean;

@class QTPurpleTopLevel;
@class QTActor;
@class QTPayload;
@class QTComment;
@class QTUser;
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
@property (nonatomic) NSString *gravatarID;
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
@property (nonatomic) NSString *gravatarID;
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
@property (nonatomic) NSString *type;
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

NS_ASSUME_NONNULL_BEGIN

id NSNullify(id _Nullable nullable) {
    BOOL isNull = nullable == nil || [nullable isEqualTo:[NSNull null]];
    return isNull ? [NSNull null] : nullable;
}

id NSNullMap(id _Nullable nullable,  id (^f)( id element)) {
    BOOL isNull = [NSNullify(nullable) isEqualTo:[NSNull null]];
    return isNull ? [NSNull null] : f(nullable);
}

#define NSNullOrNil(x) [NSNullify(x) isEqualTo:[NSNull null]]

@implementation NSArray (JSONConversion)
- (NSArray *)map:( id (^)( id element))f {
    id result = [NSMutableArray arrayWithCapacity:self.count];
    for (id x in self) [result addObject:f(x)];
    return result;
}
@end

@implementation NSDictionary (JSONConversion)
- (NSDictionary *)map:( id (^)( id value))f {
    id result = [NSMutableDictionary dictionaryWithCapacity:self.count];
    for (id key in self) [result setObject:f([self objectForKey:key]) forKey:key];
    return result;
}

- (NSException *)exceptionForKey:(id )key type:(NSString *)type {
    return [NSException exceptionWithName:@"TypeException"
                                   reason:[NSString stringWithFormat:@"Expected a %@", type]
                                 userInfo:@{ @"dictionary":self, @"key":key }];
}

- (NSString *)stringForKey:(NSString *)key {
    id value = [self objectForKey:key];
    if ([value isKindOfClass:[NSString class]]) {
        return value;
    } else {
        @throw [self exceptionForKey:key type:@"string"];
    }
}

- (NSNumber *)numberForKey:(NSString *)key {
    id value = [self objectForKey:key];
    // TODO Could this check be more precise?
    if ([value isKindOfClass:[NSNumber class]]) {
        return value;
    } else {
        @throw [self exceptionForKey:key type:@"number"];
    }
}

- (NSBoolean *)boolForKey:(NSString *)key {
    id value = [self objectForKey:key];
    if ([value isEqual:@(YES)] || [value isEqual:@(NO)]) {
        return value;
    } else {
        @throw [self exceptionForKey:key type:@"bool"];
    }
}

- (NSArray *)arrayForKey:(NSString *)key {
    id value = [self objectForKey:key];
    if ([value isKindOfClass:[NSArray class]]) {
        return value;
    } else {
        @throw [self exceptionForKey:key type:@"array"];
    }
}

- (NSDictionary *)dictionaryForKey:(NSString *)key {
    id value = [self objectForKey:key];
    if ([value isKindOfClass:[NSDictionary class]]) {
        return value;
    } else {
        @throw [self exceptionForKey:key type:@"dictionary"];
    }
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
        self.id = [dict stringForKey:@"id"];
        type = [dict stringForKey:@"type"];
        actor = [QTActor fromJSONDictionary:[dict dictionaryForKey:@"actor"]];
        repo = [QTTopLevelRepo fromJSONDictionary:[dict dictionaryForKey:@"repo"]];
        payload = [QTPayload fromJSONDictionary:[dict dictionaryForKey:@"payload"]];
        public = [dict boolForKey:@"public"];
        createdAt = [dict stringForKey:@"created_at"];
        
        if (!NSNullOrNil([dict objectForKey:@"org"])) {
            org = [QTActor fromJSONDictionary:[dict dictionaryForKey:@"org"]];
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
             @"org": NSNullMap(NSNullify(org), λ(id x, [x JSONDictionary])),
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
        self.id = [dict numberForKey:@"id"];
        login = [dict stringForKey:@"login"];
        
        if (!NSNullOrNil([dict objectForKey:@"display_login"])) {
            displayLogin = [dict stringForKey:@"display_login"];
        }
        
        gravatarID = [dict stringForKey:@"gravatar_id"];
        url = [dict stringForKey:@"url"];
        avatarURL = [dict stringForKey:@"avatar_url"];
    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
             @"id": self.id,
             @"login": login,
             @"display_login": NSNullify(displayLogin),
             @"gravatar_id": gravatarID,
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
        
        if (!NSNullOrNil([dict objectForKey:@"push_id"])) {
            pushID = [dict numberForKey:@"push_id"];
        }
        
        if (!NSNullOrNil([dict objectForKey:@"size"])) {
            size = [dict numberForKey:@"size"];
        }
        
        if (!NSNullOrNil([dict objectForKey:@"distinct_size"])) {
            distinctSize = [dict numberForKey:@"distinct_size"];
        }
        
        if (!NSNullOrNil([dict objectForKey:@"ref"])) {
            ref = [dict stringForKey:@"ref"];
        }
        
        if (!NSNullOrNil([dict objectForKey:@"head"])) {
            head = [dict stringForKey:@"head"];
        }
        
        if (!NSNullOrNil([dict objectForKey:@"before"])) {
            before = [dict stringForKey:@"before"];
        }
        
        if (!NSNullOrNil([dict objectForKey:@"commits"])) {
            commits = [[dict arrayForKey:@"commits"] map:λ(id x, [QTCommit fromJSONDictionary:x])];
        }
        
        if (!NSNullOrNil([dict objectForKey:@"action"])) {
            action = [dict stringForKey:@"action"];
        }
        
        if (!NSNullOrNil([dict objectForKey:@"issue"])) {
            issue = [QTIssue fromJSONDictionary:[dict dictionaryForKey:@"issue"]];
        }
        
        if (!NSNullOrNil([dict objectForKey:@"comment"])) {
            comment = [QTComment fromJSONDictionary:[dict dictionaryForKey:@"comment"]];
        }
        
        if (!NSNullOrNil([dict objectForKey:@"ref_type"])) {
            refType = [dict stringForKey:@"ref_type"];
        }
        
        if (!NSNullOrNil([dict objectForKey:@"master_branch"])) {
            masterBranch = [dict stringForKey:@"master_branch"];
        }
        
        if (!NSNullOrNil([dict objectForKey:@"description"])) {
            description = [dict stringForKey:@"description"];
        }
        
        if (!NSNullOrNil([dict objectForKey:@"pusher_type"])) {
            pusherType = [dict stringForKey:@"pusher_type"];
        }
        
        if (!NSNullOrNil([dict objectForKey:@"number"])) {
            number = [dict numberForKey:@"number"];
        }
        
        if (!NSNullOrNil([dict objectForKey:@"pull_request"])) {
            pullRequest = [QTPayloadPullRequest fromJSONDictionary:[dict dictionaryForKey:@"pull_request"]];
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
             @"commits": NSNullMap(NSNullify(commits), λ(id x, [x map:λ(id x, [x JSONDictionary])])),
             @"action": NSNullify(action),
             @"issue": NSNullMap(NSNullify(issue), λ(id x, [x JSONDictionary])),
             @"comment": NSNullMap(NSNullify(comment), λ(id x, [x JSONDictionary])),
             @"ref_type": NSNullify(refType),
             @"master_branch": NSNullify(masterBranch),
             @"description": NSNullify(description),
             @"pusher_type": NSNullify(pusherType),
             @"number": NSNullify(number),
             @"pull_request": NSNullMap(NSNullify(pullRequest), λ(id x, [x JSONDictionary])),
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
        url = [dict stringForKey:@"url"];
        htmlURL = [dict stringForKey:@"html_url"];
        issueURL = [dict stringForKey:@"issue_url"];
        self.id = [dict numberForKey:@"id"];
        user = [QTUser fromJSONDictionary:[dict dictionaryForKey:@"user"]];
        createdAt = [dict stringForKey:@"created_at"];
        updatedAt = [dict stringForKey:@"updated_at"];
        body = [dict stringForKey:@"body"];
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
        login = [dict stringForKey:@"login"];
        self.id = [dict numberForKey:@"id"];
        avatarURL = [dict stringForKey:@"avatar_url"];
        gravatarID = [dict stringForKey:@"gravatar_id"];
        url = [dict stringForKey:@"url"];
        htmlURL = [dict stringForKey:@"html_url"];
        followersURL = [dict stringForKey:@"followers_url"];
        followingURL = [dict stringForKey:@"following_url"];
        gistsURL = [dict stringForKey:@"gists_url"];
        starredURL = [dict stringForKey:@"starred_url"];
        subscriptionsURL = [dict stringForKey:@"subscriptions_url"];
        organizationsURL = [dict stringForKey:@"organizations_url"];
        reposURL = [dict stringForKey:@"repos_url"];
        eventsURL = [dict stringForKey:@"events_url"];
        receivedEventsURL = [dict stringForKey:@"received_events_url"];
        type = [dict stringForKey:@"type"];
        siteAdmin = [dict boolForKey:@"site_admin"];
    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
             @"login": login,
             @"id": self.id,
             @"avatar_url": avatarURL,
             @"gravatar_id": gravatarID,
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
             @"type": type,
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
        sha = [dict stringForKey:@"sha"];
        author = [QTAuthor fromJSONDictionary:[dict dictionaryForKey:@"author"]];
        message = [dict stringForKey:@"message"];
        distinct = [dict boolForKey:@"distinct"];
        url = [dict stringForKey:@"url"];
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
        email = [dict stringForKey:@"email"];
        name = [dict stringForKey:@"name"];
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
        url = [dict stringForKey:@"url"];
        repositoryURL = [dict stringForKey:@"repository_url"];
        labelsURL = [dict stringForKey:@"labels_url"];
        commentsURL = [dict stringForKey:@"comments_url"];
        eventsURL = [dict stringForKey:@"events_url"];
        htmlURL = [dict stringForKey:@"html_url"];
        self.id = [dict numberForKey:@"id"];
        number = [dict numberForKey:@"number"];
        title = [dict stringForKey:@"title"];
        user = [QTUser fromJSONDictionary:[dict dictionaryForKey:@"user"]];
        labels = [[dict arrayForKey:@"labels"] map:λ(id x, [QTLabel fromJSONDictionary:x])];
        state = [dict stringForKey:@"state"];
        locked = [dict boolForKey:@"locked"];
        assignee = [dict objectForKey:@"assignee"];
        assignees = [[dict arrayForKey:@"assignees"] map:λ(id x, x)];
        
        if (!NSNullOrNil([dict objectForKey:@"milestone"])) {
            milestone = [QTMilestone fromJSONDictionary:[dict dictionaryForKey:@"milestone"]];
        }
        
        comments = [dict numberForKey:@"comments"];
        createdAt = [dict stringForKey:@"created_at"];
        updatedAt = [dict stringForKey:@"updated_at"];
        
        if (!NSNullOrNil([dict objectForKey:@"closed_at"])) {
            closedAt = [dict stringForKey:@"closed_at"];
        }
        
        body = [dict stringForKey:@"body"];
        
        if (!NSNullOrNil([dict objectForKey:@"pull_request"])) {
            pullRequest = [QTIssuePullRequest fromJSONDictionary:[dict dictionaryForKey:@"pull_request"]];
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
             @"milestone": NSNullMap(NSNullify(milestone), λ(id x, [x JSONDictionary])),
             @"comments": comments,
             @"created_at": createdAt,
             @"updated_at": updatedAt,
             @"closed_at": NSNullify(closedAt),
             @"body": body,
             @"pull_request": NSNullMap(NSNullify(pullRequest), λ(id x, [x JSONDictionary])),
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
        self.id = [dict numberForKey:@"id"];
        url = [dict stringForKey:@"url"];
        name = [dict stringForKey:@"name"];
        color = [dict stringForKey:@"color"];
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
        url = [dict stringForKey:@"url"];
        htmlURL = [dict stringForKey:@"html_url"];
        labelsURL = [dict stringForKey:@"labels_url"];
        self.id = [dict numberForKey:@"id"];
        number = [dict numberForKey:@"number"];
        title = [dict stringForKey:@"title"];
        description = [dict stringForKey:@"description"];
        creator = [QTUser fromJSONDictionary:[dict dictionaryForKey:@"creator"]];
        openIssues = [dict numberForKey:@"open_issues"];
        closedIssues = [dict numberForKey:@"closed_issues"];
        state = [dict stringForKey:@"state"];
        createdAt = [dict stringForKey:@"created_at"];
        updatedAt = [dict stringForKey:@"updated_at"];
        
        if (!NSNullOrNil([dict objectForKey:@"due_on"])) {
            dueOn = [dict stringForKey:@"due_on"];
        }
        
        closedAt = [dict objectForKey:@"closed_at"];
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
        url = [dict stringForKey:@"url"];
        htmlURL = [dict stringForKey:@"html_url"];
        diffURL = [dict stringForKey:@"diff_url"];
        patchURL = [dict stringForKey:@"patch_url"];
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
        url = [dict stringForKey:@"url"];
        self.id = [dict numberForKey:@"id"];
        htmlURL = [dict stringForKey:@"html_url"];
        diffURL = [dict stringForKey:@"diff_url"];
        patchURL = [dict stringForKey:@"patch_url"];
        issueURL = [dict stringForKey:@"issue_url"];
        number = [dict numberForKey:@"number"];
        state = [dict stringForKey:@"state"];
        locked = [dict boolForKey:@"locked"];
        title = [dict stringForKey:@"title"];
        user = [QTUser fromJSONDictionary:[dict dictionaryForKey:@"user"]];
        body = [dict stringForKey:@"body"];
        createdAt = [dict stringForKey:@"created_at"];
        updatedAt = [dict stringForKey:@"updated_at"];
        closedAt = [dict stringForKey:@"closed_at"];
        mergedAt = [dict stringForKey:@"merged_at"];
        mergeCommitSHA = [dict stringForKey:@"merge_commit_sha"];
        assignee = [dict objectForKey:@"assignee"];
        assignees = [[dict arrayForKey:@"assignees"] map:λ(id x, x)];
        requestedReviewers = [[dict arrayForKey:@"requested_reviewers"] map:λ(id x, x)];
        milestone = [dict objectForKey:@"milestone"];
        commitsURL = [dict stringForKey:@"commits_url"];
        reviewCommentsURL = [dict stringForKey:@"review_comments_url"];
        reviewCommentURL = [dict stringForKey:@"review_comment_url"];
        commentsURL = [dict stringForKey:@"comments_url"];
        statusesURL = [dict stringForKey:@"statuses_url"];
        head = [QTBase fromJSONDictionary:[dict dictionaryForKey:@"head"]];
        base = [QTBase fromJSONDictionary:[dict dictionaryForKey:@"base"]];
        links = [QTLinks fromJSONDictionary:[dict dictionaryForKey:@"_links"]];
        merged = [dict boolForKey:@"merged"];
        mergeable = [dict objectForKey:@"mergeable"];
        rebaseable = [dict objectForKey:@"rebaseable"];
        mergeableState = [dict stringForKey:@"mergeable_state"];
        mergedBy = [QTUser fromJSONDictionary:[dict dictionaryForKey:@"merged_by"]];
        comments = [dict numberForKey:@"comments"];
        reviewComments = [dict numberForKey:@"review_comments"];
        maintainerCanModify = [dict boolForKey:@"maintainer_can_modify"];
        commits = [dict numberForKey:@"commits"];
        additions = [dict numberForKey:@"additions"];
        deletions = [dict numberForKey:@"deletions"];
        changedFiles = [dict numberForKey:@"changed_files"];
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
        label = [dict stringForKey:@"label"];
        ref = [dict stringForKey:@"ref"];
        sha = [dict stringForKey:@"sha"];
        user = [QTUser fromJSONDictionary:[dict dictionaryForKey:@"user"]];
        repo = [QTBaseRepo fromJSONDictionary:[dict dictionaryForKey:@"repo"]];
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
        self.id = [dict numberForKey:@"id"];
        name = [dict stringForKey:@"name"];
        fullName = [dict stringForKey:@"full_name"];
        owner = [QTUser fromJSONDictionary:[dict dictionaryForKey:@"owner"]];
        private = [dict boolForKey:@"private"];
        htmlURL = [dict stringForKey:@"html_url"];
        description = [dict stringForKey:@"description"];
        fork = [dict boolForKey:@"fork"];
        url = [dict stringForKey:@"url"];
        forksURL = [dict stringForKey:@"forks_url"];
        keysURL = [dict stringForKey:@"keys_url"];
        collaboratorsURL = [dict stringForKey:@"collaborators_url"];
        teamsURL = [dict stringForKey:@"teams_url"];
        hooksURL = [dict stringForKey:@"hooks_url"];
        issueEventsURL = [dict stringForKey:@"issue_events_url"];
        eventsURL = [dict stringForKey:@"events_url"];
        assigneesURL = [dict stringForKey:@"assignees_url"];
        branchesURL = [dict stringForKey:@"branches_url"];
        tagsURL = [dict stringForKey:@"tags_url"];
        blobsURL = [dict stringForKey:@"blobs_url"];
        gitTagsURL = [dict stringForKey:@"git_tags_url"];
        gitRefsURL = [dict stringForKey:@"git_refs_url"];
        treesURL = [dict stringForKey:@"trees_url"];
        statusesURL = [dict stringForKey:@"statuses_url"];
        languagesURL = [dict stringForKey:@"languages_url"];
        stargazersURL = [dict stringForKey:@"stargazers_url"];
        contributorsURL = [dict stringForKey:@"contributors_url"];
        subscribersURL = [dict stringForKey:@"subscribers_url"];
        subscriptionURL = [dict stringForKey:@"subscription_url"];
        commitsURL = [dict stringForKey:@"commits_url"];
        gitCommitsURL = [dict stringForKey:@"git_commits_url"];
        commentsURL = [dict stringForKey:@"comments_url"];
        issueCommentURL = [dict stringForKey:@"issue_comment_url"];
        contentsURL = [dict stringForKey:@"contents_url"];
        compareURL = [dict stringForKey:@"compare_url"];
        mergesURL = [dict stringForKey:@"merges_url"];
        archiveURL = [dict stringForKey:@"archive_url"];
        downloadsURL = [dict stringForKey:@"downloads_url"];
        issuesURL = [dict stringForKey:@"issues_url"];
        pullsURL = [dict stringForKey:@"pulls_url"];
        milestonesURL = [dict stringForKey:@"milestones_url"];
        notificationsURL = [dict stringForKey:@"notifications_url"];
        labelsURL = [dict stringForKey:@"labels_url"];
        releasesURL = [dict stringForKey:@"releases_url"];
        deploymentsURL = [dict stringForKey:@"deployments_url"];
        createdAt = [dict stringForKey:@"created_at"];
        updatedAt = [dict stringForKey:@"updated_at"];
        pushedAt = [dict stringForKey:@"pushed_at"];
        gitURL = [dict stringForKey:@"git_url"];
        sshURL = [dict stringForKey:@"ssh_url"];
        cloneURL = [dict stringForKey:@"clone_url"];
        svnURL = [dict stringForKey:@"svn_url"];
        homepage = [dict stringForKey:@"homepage"];
        size = [dict numberForKey:@"size"];
        stargazersCount = [dict numberForKey:@"stargazers_count"];
        watchersCount = [dict numberForKey:@"watchers_count"];
        language = [dict stringForKey:@"language"];
        hasIssues = [dict boolForKey:@"has_issues"];
        hasProjects = [dict boolForKey:@"has_projects"];
        hasDownloads = [dict boolForKey:@"has_downloads"];
        hasWiki = [dict boolForKey:@"has_wiki"];
        hasPages = [dict boolForKey:@"has_pages"];
        forksCount = [dict numberForKey:@"forks_count"];
        mirrorURL = [dict objectForKey:@"mirror_url"];
        openIssuesCount = [dict numberForKey:@"open_issues_count"];
        forks = [dict numberForKey:@"forks"];
        openIssues = [dict numberForKey:@"open_issues"];
        watchers = [dict numberForKey:@"watchers"];
        defaultBranch = [dict stringForKey:@"default_branch"];
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
        self.self = [QTComments fromJSONDictionary:[dict dictionaryForKey:@"self"]];
        html = [QTComments fromJSONDictionary:[dict dictionaryForKey:@"html"]];
        issue = [QTComments fromJSONDictionary:[dict dictionaryForKey:@"issue"]];
        comments = [QTComments fromJSONDictionary:[dict dictionaryForKey:@"comments"]];
        reviewComments = [QTComments fromJSONDictionary:[dict dictionaryForKey:@"review_comments"]];
        reviewComment = [QTComments fromJSONDictionary:[dict dictionaryForKey:@"review_comment"]];
        commits = [QTComments fromJSONDictionary:[dict dictionaryForKey:@"commits"]];
        statuses = [QTComments fromJSONDictionary:[dict dictionaryForKey:@"statuses"]];
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
        href = [dict stringForKey:@"href"];
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
        self.id = [dict numberForKey:@"id"];
        name = [dict stringForKey:@"name"];
        url = [dict stringForKey:@"url"];
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

// To parse this JSON:
//
//   NSError *error;
//   QTTopLevel *topLevel = [QTTopLevel fromJSON:json encoding:NSUTF8Encoding error:&error]

#import <Foundation/Foundation.h>

// MARK: Types

// This clarifies which properties are JSON booleans
typedef NSNumber NSBoolean;

@class QTTopLevel;
@class QTPokemon;
@class QTEgg;
@class QTEvolution;
@class QTWeakness;

NS_ASSUME_NONNULL_BEGIN

@interface QTEgg : NSObject
@property (nonatomic, readonly, copy) NSString *value;
+ (instancetype _Nullable)withValue:(NSString *)value;
+ (QTEgg *)notInEggs;
+ (QTEgg *)omanyteCandy;
+ (QTEgg *)the10KM;
+ (QTEgg *)the2KM;
+ (QTEgg *)the5KM;
@end

@interface QTWeakness : NSObject
@property (nonatomic, readonly, copy) NSString *value;
+ (instancetype _Nullable)withValue:(NSString *)value;
+ (QTWeakness *)bug;
+ (QTWeakness *)dark;
+ (QTWeakness *)dragon;
+ (QTWeakness *)electric;
+ (QTWeakness *)fairy;
+ (QTWeakness *)fighting;
+ (QTWeakness *)fire;
+ (QTWeakness *)flying;
+ (QTWeakness *)ghost;
+ (QTWeakness *)grass;
+ (QTWeakness *)ground;
+ (QTWeakness *)ice;
+ (QTWeakness *)poison;
+ (QTWeakness *)psychic;
+ (QTWeakness *)rock;
+ (QTWeakness *)steel;
+ (QTWeakness *)water;
@end

// MARK: Top-level marshalling functions

// QTTopLevel
QTTopLevel *QTTopLevelFromData(NSData *data, NSError **error);
QTTopLevel *QTTopLevelFromJSON(NSString *json, NSStringEncoding encoding, NSError **error);
NSData *QTTopLevelToData(QTTopLevel *topLevel, NSError **error);
NSString *QTTopLevelToJSON(QTTopLevel *topLevel, NSStringEncoding encoding, NSError **error);

@interface QTTopLevel : NSObject
@property (nonatomic) NSArray<QTPokemon *> *pokemon;

+ (_Nullable instancetype)fromJSON:(NSString *)json;
+ (_Nullable instancetype)fromJSON:(NSString *)json encoding:(NSStringEncoding)encoding error:(NSError *_Nullable *)error;
+ (_Nullable instancetype)fromData:(NSData *)data error:(NSError *_Nullable *)error;
- (NSString *_Nullable)toJSON;
- (NSString *_Nullable)toJSON:(NSStringEncoding)encoding error:(NSError *_Nullable *)error;
- (NSData *_Nullable)toData:(NSError *_Nullable *)error;
@end

@interface QTPokemon : NSObject
@property (nonatomic) NSNumber *id;
@property (nonatomic) NSString *num;
@property (nonatomic) NSString *name;
@property (nonatomic) NSString *img;
@property (nonatomic) NSArray<NSString *> *type;
@property (nonatomic) NSString *height;
@property (nonatomic) NSString *weight;
@property (nonatomic) NSString *candy;
@property (nonatomic, nullable) NSNumber *candyCount;
@property (nonatomic) QTEgg *egg;
@property (nonatomic) NSNumber *spawnChance;
@property (nonatomic) NSNumber *avgSpawns;
@property (nonatomic) NSString *spawnTime;
@property (nonatomic, nullable) NSArray<NSNumber *> *multipliers;
@property (nonatomic) NSArray<QTWeakness *> *weaknesses;
@property (nonatomic, nullable) NSArray<QTEvolution *> *nextEvolution;
@property (nonatomic, nullable) NSArray<QTEvolution *> *prevEvolution;
@end

@interface QTEvolution : NSObject
@property (nonatomic) NSString *num;
@property (nonatomic) NSString *name;
@end

NS_ASSUME_NONNULL_END

// MARK: Implementation

// Shorthand for simple blocks
#define λ(decl, expr) (^(decl) { return (expr); })

// NSNull → nil conversion and assertion
#define NSNullify(x) ([x isNotEqualTo:[NSNull null]] ? x : [NSNull null])
#define NotNil(x) (x ? x : throw(@"Unexpected nil"))

// Allows us to create throw expressions.
// 
// Although exceptions are rarely used in Objective-C, they're used internally
// here to short-circuit recursive JSON processing. Soon they will be caught at
// the API boundary and convered to NSError.
id _Nullable throw(NSString * _Nullable reason) {
    @throw [NSException exceptionWithName:@"JSONSerialization" reason:reason userInfo:nil];
    return nil;
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

- (id)objectForKey:(NSString *)key withClass:(Class)cls {
    id value = [self objectForKey:key];
    if ([value isKindOfClass:cls]) return value;
    else return throw([NSString stringWithFormat:@"Expected a %@", cls]);
}

- (NSBoolean *)boolForKey:(NSString *)key {
    id value = [self objectForKey:key];
    if ([value isEqual:@YES] || [value isEqual:@NO]) return value;
    else return throw(@"Expected bool");
}
@end

// MARK: Private model interfaces

@interface QTTopLevel (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTPokemon (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

@interface QTEvolution (JSONConversion)
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;
- (NSDictionary *)JSONDictionary;
@end

// MARK: Pseudo-enum implementations

@implementation QTEgg

static NSMutableDictionary<NSString *, QTEgg *> *qtEggs;

+ (QTEgg *)notInEggs { return qtEggs[@"Not in Eggs"]; }
+ (QTEgg *)omanyteCandy { return qtEggs[@"Omanyte Candy"]; }
+ (QTEgg *)the10KM { return qtEggs[@"10 km"]; }
+ (QTEgg *)the2KM { return qtEggs[@"2 km"]; }
+ (QTEgg *)the5KM { return qtEggs[@"5 km"]; }

+ (void)initialize
{
    NSArray<NSString *> *values = @[
        @"Not in Eggs",
        @"Omanyte Candy",
        @"10 km",
        @"2 km",
        @"5 km",
    ];
    qtEggs = [NSMutableDictionary dictionaryWithCapacity:values.count];
    for (NSString *value in values) qtEggs[value] = [[QTEgg alloc] initWithValue:value];
}

+ (instancetype _Nullable)withValue:(NSString *)value { return qtEggs[value]; }

- (instancetype)initWithValue:(NSString *)value
{
    if (self = [super init]) _value = value;
    return self;
}

- (NSUInteger)hash { return _value.hash; }
@end

@implementation QTWeakness

static NSMutableDictionary<NSString *, QTWeakness *> *qtWeaknesses;

+ (QTWeakness *)bug { return qtWeaknesses[@"Bug"]; }
+ (QTWeakness *)dark { return qtWeaknesses[@"Dark"]; }
+ (QTWeakness *)dragon { return qtWeaknesses[@"Dragon"]; }
+ (QTWeakness *)electric { return qtWeaknesses[@"Electric"]; }
+ (QTWeakness *)fairy { return qtWeaknesses[@"Fairy"]; }
+ (QTWeakness *)fighting { return qtWeaknesses[@"Fighting"]; }
+ (QTWeakness *)fire { return qtWeaknesses[@"Fire"]; }
+ (QTWeakness *)flying { return qtWeaknesses[@"Flying"]; }
+ (QTWeakness *)ghost { return qtWeaknesses[@"Ghost"]; }
+ (QTWeakness *)grass { return qtWeaknesses[@"Grass"]; }
+ (QTWeakness *)ground { return qtWeaknesses[@"Ground"]; }
+ (QTWeakness *)ice { return qtWeaknesses[@"Ice"]; }
+ (QTWeakness *)poison { return qtWeaknesses[@"Poison"]; }
+ (QTWeakness *)psychic { return qtWeaknesses[@"Psychic"]; }
+ (QTWeakness *)rock { return qtWeaknesses[@"Rock"]; }
+ (QTWeakness *)steel { return qtWeaknesses[@"Steel"]; }
+ (QTWeakness *)water { return qtWeaknesses[@"Water"]; }

+ (void)initialize
{
    NSArray<NSString *> *values = @[
        @"Bug",
        @"Dark",
        @"Dragon",
        @"Electric",
        @"Fairy",
        @"Fighting",
        @"Fire",
        @"Flying",
        @"Ghost",
        @"Grass",
        @"Ground",
        @"Ice",
        @"Poison",
        @"Psychic",
        @"Rock",
        @"Steel",
        @"Water",
    ];
    qtWeaknesses = [NSMutableDictionary dictionaryWithCapacity:values.count];
    for (NSString *value in values) qtWeaknesses[value] = [[QTWeakness alloc] initWithValue:value];
}

+ (instancetype _Nullable)withValue:(NSString *)value { return qtWeaknesses[value]; }

- (instancetype)initWithValue:(NSString *)value
{
    if (self = [super init]) _value = value;
    return self;
}

- (NSUInteger)hash { return _value.hash; }
@end

// MARK: JSON serialization implementations

QTTopLevel *QTTopLevelFromData(NSData *data, NSError **error) {
    NSDictionary<NSString *, id> *json = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingAllowFragments error:error];
    return *error ? nil : [QTTopLevel fromJSONDictionary:json];
}

QTTopLevel *QTTopLevelFromJSON(NSString *json, NSStringEncoding encoding, NSError **error) {
    return QTTopLevelFromData([json dataUsingEncoding:encoding], error);
}

NSData *QTTopLevelToData(QTTopLevel *topLevel, NSError **error) {
    NSDictionary<NSString *, id> *json = [topLevel JSONDictionary];
    NSData *data = [NSJSONSerialization dataWithJSONObject:json options:kNilOptions error:error];
    return *error ? nil : data;
}

NSString *QTTopLevelToJSON(QTTopLevel *topLevel, NSStringEncoding encoding, NSError **error) {
    NSData *data = QTTopLevelToData(topLevel, error);
    return data ? [[NSString alloc] initWithData:data encoding:encoding] : nil;
}

@implementation QTTopLevel
+ (_Nullable instancetype)fromData:(NSData *)data error:(NSError *_Nullable *)error {
    return QTTopLevelFromData(data, error);
}

+ (_Nullable instancetype)fromJSON:(NSString *)json encoding:(NSStringEncoding)encoding error:(NSError *_Nullable *)error; {
    return QTTopLevelFromJSON(json, encoding, error);
}

+ (_Nullable instancetype)fromJSON:(NSString *)json {
    NSError *error;
    return QTTopLevelFromJSON(json, NSUTF8StringEncoding, &error);
}

+ (instancetype)fromJSONDictionary:(NSDictionary *)dict {
    return [[QTTopLevel alloc] initWithJSONDictionary:dict];
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict {
    if (self = [super init]) {
        _pokemon = [[dict objectForKey:@"pokemon" withClass:[NSArray class]] map:λ(id x, [QTPokemon fromJSONDictionary:x])];
    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
        @"pokemon": [_pokemon map:λ(id x, [x JSONDictionary])],
    };
}

- (NSData *_Nullable)toData:(NSError *_Nullable *)error {
    return QTTopLevelToData(self, error);
}

- (NSString *_Nullable)toJSON:(NSStringEncoding)encoding error:(NSError *_Nullable *)error {
    return QTTopLevelToJSON(self, encoding, error);
}

- (NSString *_Nullable)toJSON {
    NSError *error;
    return QTTopLevelToJSON(self, NSUTF8StringEncoding, &error);
}
@end

@implementation QTPokemon
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict {
    return [[QTPokemon alloc] initWithJSONDictionary:dict];
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict {
    if (self = [super init]) {
        _id = [dict objectForKey:@"id" withClass:[NSNumber class]];
        _num = [dict objectForKey:@"num" withClass:[NSString class]];
        _name = [dict objectForKey:@"name" withClass:[NSString class]];
        _img = [dict objectForKey:@"img" withClass:[NSString class]];
        _type = [[dict objectForKey:@"type" withClass:[NSArray class]] map:λ(id x, x)];
        _height = [dict objectForKey:@"height" withClass:[NSString class]];
        _weight = [dict objectForKey:@"weight" withClass:[NSString class]];
        _candy = [dict objectForKey:@"candy" withClass:[NSString class]];

        if ([[dict objectForKey:@"candy_count"] isNotEqualTo:[NSNull null]]) {
            _candyCount = [dict objectForKey:@"candy_count" withClass:[NSNumber class]];
        }

        _egg = NotNil([QTEgg withValue:[dict objectForKey:@"egg" withClass:[NSString class]]]);
        _spawnChance = [dict objectForKey:@"spawn_chance" withClass:[NSNumber class]];
        _avgSpawns = [dict objectForKey:@"avg_spawns" withClass:[NSNumber class]];
        _spawnTime = [dict objectForKey:@"spawn_time" withClass:[NSString class]];

        if ([[dict objectForKey:@"multipliers"] isNotEqualTo:[NSNull null]]) {
            _multipliers = [[dict objectForKey:@"multipliers" withClass:[NSArray class]] map:λ(id x, x)];
        }

        _weaknesses = [[dict objectForKey:@"weaknesses" withClass:[NSArray class]] map:λ(id x, NotNil([QTWeakness withValue:x]))];

        if ([[dict objectForKey:@"next_evolution"] isNotEqualTo:[NSNull null]]) {
            _nextEvolution = [[dict objectForKey:@"next_evolution" withClass:[NSArray class]] map:λ(id x, [QTEvolution fromJSONDictionary:x])];
        }

        if ([[dict objectForKey:@"prev_evolution"] isNotEqualTo:[NSNull null]]) {
            _prevEvolution = [[dict objectForKey:@"prev_evolution" withClass:[NSArray class]] map:λ(id x, [QTEvolution fromJSONDictionary:x])];
        }

    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
        @"id": _id,
        @"num": _num,
        @"name": _name,
        @"img": _img,
        @"type": _type,
        @"height": _height,
        @"weight": _weight,
        @"candy": _candy,
        @"candy_count": NSNullify(_candyCount),
        @"egg": [_egg value],
        @"spawn_chance": _spawnChance,
        @"avg_spawns": _avgSpawns,
        @"spawn_time": _spawnTime,
        @"multipliers": NSNullify(_multipliers),
        @"weaknesses": [_weaknesses map:λ(id x, [x value])],
        @"next_evolution": NSNullify([_nextEvolution map:λ(id x, [x JSONDictionary])]),
        @"prev_evolution": NSNullify([_prevEvolution map:λ(id x, [x JSONDictionary])]),
    };
}
@end

@implementation QTEvolution
+ (instancetype)fromJSONDictionary:(NSDictionary *)dict {
    return [[QTEvolution alloc] initWithJSONDictionary:dict];
}

- (instancetype)initWithJSONDictionary:(NSDictionary *)dict {
    if (self = [super init]) {
        _num = [dict objectForKey:@"num" withClass:[NSString class]];
        _name = [dict objectForKey:@"name" withClass:[NSString class]];
    }
    return self;
}

- (NSDictionary *)JSONDictionary {
    return @{
        @"num": _num,
        @"name": _name,
    };
}
@end

NS_ASSUME_NONNULL_END

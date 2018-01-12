#import <Foundation/Foundation.h>

#import "QTTopLevel.h"

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        NSString *filePath = argv[1] != NULL
            ? [NSString stringWithCString:argv[1] encoding:NSUTF8StringEncoding]
            : [NSString stringWithFormat:@"%@/sample.json", [@__FILE__ stringByDeletingLastPathComponent]];
        
        if (![NSFileManager.defaultManager fileExistsAtPath:filePath]) {
            NSLog(@"Specify an input JSON file");
            exit(1);
        }
        
        NSError *error;
        NSString *inputJSON = [NSString stringWithContentsOfFile:filePath
                                                        encoding:NSUTF8StringEncoding
                                                           error:&error];
        if (error) {
            NSLog(@"Could not read JSON file %@: %@", filePath, error);
            exit(1);
        }
        
        QTTopLevel *top = QTTopLevelFromJSON(inputJSON, NSUTF8StringEncoding, &error);
        if (error) {
            NSLog(@"Could not convert JSON to model: %@", error);
            exit(1);
        }
        
        NSString *outputJSON = QTTopLevelToJSON(top, NSUTF8StringEncoding, &error);
        if (error) {
            NSLog(@"Could not convert model to JSON: %@", error);
            exit(1);
        }
        
        printf("%s", [outputJSON UTF8String]);
    }
    return 0;
}


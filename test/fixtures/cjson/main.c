#include <stdio.h>
#include <string.h>

#include "TopLevel.h"

int main(int argc, const char * argv[]) {

    if (argc != 2) {
        printf("Usage: %s FILE\n", argv[0]);
        return 1;
    }
    
    /* Open file */
    FILE *file = fopen(argv[1], "rb");
    if (NULL == file) {
        return 1;
    }
    /* Get the size of the file */
    if (0 != fseek(file, 0, SEEK_END)) {
        fclose(file);
        return 1;
    }
    long size = ftell(file);
    if (size < 0) {
        fclose(file);
        return 1;
    }
    if (0 != fseek(file, 0, SEEK_SET)) {
        fclose(file);
        return 1;
    }
    /* Allocate buffer to read the file */
    char *buffer = malloc(size + 1);
    if (NULL == buffer) {
        fclose(file);
        return 1;
    }
    /* Read file */
    if (size != fread(buffer, 1, size, file)) {
        free(buffer);
        fclose(file);
        return 1;
    }
    buffer[size] = '\0';
    /* Close file */
    fclose(file);
    
    /* Parse TopLevel */
    struct TopLevel *tl = cJSON_ParseTopLevel(buffer);
    if (NULL == tl) {
        free(buffer);
        return 1;    
    }
    
    /* Print TopLevel */
    char *result = cJSON_PrintTopLevel(tl);
    if (NULL == result) {
        cJSON_DeleteTopLevel(tl);
        free(buffer);    
        return 1;
    }
    printf("%s\n", result);
    
    /* Release memory */
    free(result);
    cJSON_DeleteTopLevel(tl);
    free(buffer);

    return 0;
}

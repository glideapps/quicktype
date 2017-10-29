#include <iostream>
#include <string>
#include <fstream>
#include <streambuf>

#include "quicktype.hpp"

using quicktype::topLevel;
using nlohmann::json;

int main(int argc, const char * argv[]) {
    if (argc != 2) {
        std::cerr << "Usage: " << argv[0] << " FILE";
        return 1;
    }
    
    std::ifstream t(argv[1]);
    std::string str((std::istreambuf_iterator<char>(t)),
                    std::istreambuf_iterator<char>());

    topLevel tl = json::parse(str);
    json j2 = tl;
    
    std::cout << j2 << std::endl;

    return 0;
}

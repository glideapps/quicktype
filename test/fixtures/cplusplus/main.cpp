//
//  main.cpp
//  CppJson
//
//  Created by Mark Probst on 10/22/17.
//  Copyright © 2017 Mark Probst. All rights reserved.
//

#include <iostream>
#include <string>
#include <fstream>
#include <streambuf>
#include "json.hpp"
#include <boost/optional.hpp>
#include <boost/variant.hpp>

using nlohmann::json;

#include "quicktype.hpp"

int main(int argc, const char * argv[]) {
    if (argc != 2) {
        std::cerr << "Usage: " << argv[0] << " FILE";
        return 1;
    }
    
    std::ifstream t(argv[1]);
    std::string str((std::istreambuf_iterator<char>(t)),
                    std::istreambuf_iterator<char>());
    json j = json::parse(str);

    topLevel tl = j;
    json j2 = tl;
    
    std::cout << j2 << std::endl;

    return 0;
}

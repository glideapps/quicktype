#include <iostream>
#include <string>
#include <fstream>
#include <streambuf>

#include "TopLevel.hpp"
#include "Generators.hpp"

using quicktype::TopLevel;
using nlohmann::json;

int main(int argc, const char * argv[]) {
    if (argc != 2) {
        std::cerr << "Usage: " << argv[0] << " FILE";
        return 1;
    }

    std::ifstream t(argv[1]);
    std::string str((std::istreambuf_iterator<char>(t)),
                    std::istreambuf_iterator<char>());

    TopLevel tl = json::parse(str);
    json j2 = tl;

    std::cout << j2 << std::endl;

    return 0;
}

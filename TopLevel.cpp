//  To parse this JSON data, first install
//
//      Boost     http://www.boost.org
//      json.hpp  https://github.com/nlohmann/json
//
//  Then include this file, and then do
//
//     TopLevel data = nlohmann::json::parse(jsonString);

#pragma once

#include "json.hpp"

#include <boost/optional.hpp>
#include <stdexcept>
#include <regex>

namespace nlohmann {
    template <typename T>
    struct adl_serializer<std::shared_ptr<T>> {
        static void to_json(json& j, const std::shared_ptr<T>& opt) {
            if (!opt) j = nullptr; else j = *opt;
        }

        static std::shared_ptr<T> from_json(const json& j) {
            if (j.is_null()) return std::unique_ptr<T>(); else return std::unique_ptr<T>(new T(j.get<T>()));
        }
    };
}

namespace quicktype {
    using nlohmann::json;

    //here
    //there
    class ClassMemberConstraints {
        private:
        boost::optional<int> min_value;
        boost::optional<int> max_value;
        boost::optional<size_t> min_length;
        boost::optional<size_t> max_length;
        boost::optional<std::string> pattern;

        public:
        ClassMemberConstraints(
            boost::optional<int> min_value,
            boost::optional<int> max_value,
            boost::optional<size_t> min_length,
            boost::optional<size_t> max_length,
            boost::optional<std::string> pattern
        ) : min_value(min_value), max_value(max_value), min_length(min_length), max_length(max_length), pattern(pattern) {}
        ClassMemberConstraints() = default;
        virtual ~ClassMemberConstraints() = default;

        void set_min_value(int min_value) { this->min_value = min_value; }
        auto get_min_value() const { return min_value; }

        void set_max_value(int max_value) { this->max_value = max_value; }
        auto get_max_value() const { return max_value; }

        void set_min_length(size_t min_length) { this->min_length = min_length; }
        auto get_min_length() const { return min_length; }

        void set_max_length(size_t max_length) { this->max_length = max_length; }
        auto get_max_length() const { return max_length; }

        void set_pattern(const std::string & pattern) { this->pattern = pattern; }
        auto get_pattern() const { return pattern; }
    };

    class ClassMemberConstraintException : public std::runtime_error {
        public:
        ClassMemberConstraintException(const std::string & msg) : std::runtime_error(msg) {}
    };

    class ValueTooLowException : public ClassMemberConstraintException {
        public:
        ValueTooLowException(const std::string & msg) : ClassMemberConstraintException(msg) {}
    };

    class ValueTooHighException : public ClassMemberConstraintException {
        public:
        ValueTooHighException(const std::string & msg) : ClassMemberConstraintException(msg) {}
    };

    class ValueTooShortException : public ClassMemberConstraintException {
        public:
        ValueTooShortException(const std::string & msg) : ClassMemberConstraintException(msg) {}
    };

    class ValueTooLongException : public ClassMemberConstraintException {
        public:
        ValueTooLongException(const std::string & msg) : ClassMemberConstraintException(msg) {}
    };

    class InvalidPatternException : public ClassMemberConstraintException {
        public:
        InvalidPatternException(const std::string & msg) : ClassMemberConstraintException(msg) {}
    };

    void CheckConstraint(const std::string & name, const ClassMemberConstraints & c, int64_t value) {
        if (c.get_min_value() != boost::none && value < *c.get_min_value()) {
            throw ValueTooLowException ("Value too low for " + name + " (" + std::to_string(value) + "<" + std::to_string(*c.get_min_value()) + ")");
        }

        if (c.get_max_value() != boost::none && value > *c.get_max_value()) {
            throw ValueTooHighException ("Value too high for " + name + " (" + std::to_string(value) + ">" + std::to_string(*c.get_max_value()) + ")");
        }
    }

    void CheckConstraint(const std::string & name, const ClassMemberConstraints & c, const std::string & value) {
        if (c.get_min_length() != boost::none && value.length() < *c.get_min_length()) {
            throw ValueTooShortException ("Value too short for " + name + " (" + std::to_string(value.length()) + "<" + std::to_string(*c.get_min_length()) + ")");
        }

        if (c.get_max_length() != boost::none && value.length() > *c.get_max_length()) {
            throw ValueTooLongException ("Value too long for " + name + " (" + std::to_string(value.length()) + ">" + std::to_string(*c.get_max_length()) + ")");
        }

        if (c.get_pattern() != boost::none) {
            std::smatch result;
            std::regex_search(value, result, std::regex( *c.get_pattern() ));
            if (result.empty()) {
                throw InvalidPatternException ("Value doesn't match pattern for " + name + " (" + value +" != " + *c.get_pattern() + ")");
            }
        }
    }

    inline json get_untyped(const json &j, const char *property) {
        if (j.find(property) != j.end()) {
            return j.at(property).get<json>();
        }
        return json();
    }
    inline json get_untyped(const json &j, std::string property) {
        return get_untyped(j, property.data());
    }

    template <typename T>
    inline std::shared_ptr<T> get_optional(const json &j, const char *property) {
        if (j.find(property) != j.end()) {
            return j.at(property).get<std::shared_ptr<T>>();
        }
        return std::shared_ptr<T>();
    }

    template <typename T>
    inline std::shared_ptr<T> get_optional(const json &j, std::string property) {
        return get_optional<T>(j, property.data());
    }

    class Free {
        public:
        Free() = default;
        virtual ~Free() = default;

        private:
        std::string type;

        public:
        const std::string & get_type() const { return type; }
        std::string & get_mutable_type() { return type; }
        void set_type(const std::string& value) { this->type = value; }
    };

    class Of {
        public:
        Of() = default;
        virtual ~Of() = default;

        private:
        std::string ref;

        public:
        const std::string & get_ref() const { return ref; }
        std::string & get_mutable_ref() { return ref; }
        void set_ref(const std::string& value) { this->ref = value; }
    };

    class Intersection {
        public:
        Intersection() = default;
        virtual ~Intersection() = default;

        private:
        std::vector<Of> all_of;

        public:
        const std::vector<Of> & get_all_of() const { return all_of; }
        std::vector<Of> & get_mutable_all_of() { return all_of; }
        void set_all_of(const std::vector<Of>& value) { this->all_of = value; }
    };

    class Max {
        public:
        Max() = default;
        virtual ~Max() = default;

        private:
        std::string type;
        int64_t maximum;

        public:
        const std::string & get_type() const { return type; }
        std::string & get_mutable_type() { return type; }
        void set_type(const std::string& value) { this->type = value; }

        const int64_t & get_maximum() const { return maximum; }
        int64_t & get_mutable_maximum() { return maximum; }
        void set_maximum(const int64_t& value) { this->maximum = value; }
    };

    class Min {
        public:
        Min() = default;
        virtual ~Min() = default;

        private:
        std::string type;
        int64_t minimum;

        public:
        const std::string & get_type() const { return type; }
        std::string & get_mutable_type() { return type; }
        void set_type(const std::string& value) { this->type = value; }

        const int64_t & get_minimum() const { return minimum; }
        int64_t & get_mutable_minimum() { return minimum; }
        void set_minimum(const int64_t& value) { this->minimum = value; }
    };

    class MinMaxUnion {
        public:
        MinMaxUnion() = default;
        virtual ~MinMaxUnion() = default;

        private:
        std::vector<Of> one_of;

        public:
        const std::vector<Of> & get_one_of() const { return one_of; }
        std::vector<Of> & get_mutable_one_of() { return one_of; }
        void set_one_of(const std::vector<Of>& value) { this->one_of = value; }
    };

    class Minmax {
        public:
        Minmax() = default;
        virtual ~Minmax() = default;

        private:
        std::shared_ptr<std::string> type;
        std::shared_ptr<int64_t> minimum;
        std::shared_ptr<int64_t> maximum;
        std::shared_ptr<std::string> ref;

        public:
        std::shared_ptr<std::string> get_type() const { return type; }
        void set_type(std::shared_ptr<std::string> value) { this->type = value; }

        std::shared_ptr<int64_t> get_minimum() const { return minimum; }
        void set_minimum(std::shared_ptr<int64_t> value) { this->minimum = value; }

        std::shared_ptr<int64_t> get_maximum() const { return maximum; }
        void set_maximum(std::shared_ptr<int64_t> value) { this->maximum = value; }

        std::shared_ptr<std::string> get_ref() const { return ref; }
        void set_ref(std::shared_ptr<std::string> value) { this->ref = value; }
    };

    class Union {
        public:
        Union() = default;
        virtual ~Union() = default;

        private:
        std::vector<Minmax> one_of;

        public:
        const std::vector<Minmax> & get_one_of() const { return one_of; }
        std::vector<Minmax> & get_mutable_one_of() { return one_of; }
        void set_one_of(const std::vector<Minmax>& value) { this->one_of = value; }
    };

    class Properties {
        public:
        Properties() = default;
        virtual ~Properties() = default;

        private:
        Free free;
        Min min;
        Max max;
        Minmax minmax;
        Union properties_union;
        MinMaxUnion min_max_union;
        Intersection intersection;
        Intersection min_max_intersection;

        public:
        const Free & get_free() const { return free; }
        Free & get_mutable_free() { return free; }
        void set_free(const Free& value) { this->free = value; }

        const Min & get_min() const { return min; }
        Min & get_mutable_min() { return min; }
        void set_min(const Min& value) { this->min = value; }

        const Max & get_max() const { return max; }
        Max & get_mutable_max() { return max; }
        void set_max(const Max& value) { this->max = value; }

        const Minmax & get_minmax() const { return minmax; }
        Minmax & get_mutable_minmax() { return minmax; }
        void set_minmax(const Minmax& value) { this->minmax = value; }

        const Union & get_properties_union() const { return properties_union; }
        Union & get_mutable_properties_union() { return properties_union; }
        void set_properties_union(const Union& value) { this->properties_union = value; }

        const MinMaxUnion & get_min_max_union() const { return min_max_union; }
        MinMaxUnion & get_mutable_min_max_union() { return min_max_union; }
        void set_min_max_union(const MinMaxUnion& value) { this->min_max_union = value; }

        const Intersection & get_intersection() const { return intersection; }
        Intersection & get_mutable_intersection() { return intersection; }
        void set_intersection(const Intersection& value) { this->intersection = value; }

        const Intersection & get_min_max_intersection() const { return min_max_intersection; }
        Intersection & get_mutable_min_max_intersection() { return min_max_intersection; }
        void set_min_max_intersection(const Intersection& value) { this->min_max_intersection = value; }
    };

    class TopLevel {
        public:
        TopLevel() = default;
        virtual ~TopLevel() = default;

        private:
        std::string type;
        Properties properties;
        std::vector<std::string> required;

        public:
        const std::string & get_type() const { return type; }
        std::string & get_mutable_type() { return type; }
        void set_type(const std::string& value) { this->type = value; }

        const Properties & get_properties() const { return properties; }
        Properties & get_mutable_properties() { return properties; }
        void set_properties(const Properties& value) { this->properties = value; }

        const std::vector<std::string> & get_required() const { return required; }
        std::vector<std::string> & get_mutable_required() { return required; }
        void set_required(const std::vector<std::string>& value) { this->required = value; }
    };
}

namespace nlohmann {
    void from_json(const json& _j, quicktype::Free& _x);
    void to_json(json& _j, const quicktype::Free& _x);

    void from_json(const json& _j, quicktype::Of& _x);
    void to_json(json& _j, const quicktype::Of& _x);

    void from_json(const json& _j, quicktype::Intersection& _x);
    void to_json(json& _j, const quicktype::Intersection& _x);

    void from_json(const json& _j, quicktype::Max& _x);
    void to_json(json& _j, const quicktype::Max& _x);

    void from_json(const json& _j, quicktype::Min& _x);
    void to_json(json& _j, const quicktype::Min& _x);

    void from_json(const json& _j, quicktype::MinMaxUnion& _x);
    void to_json(json& _j, const quicktype::MinMaxUnion& _x);

    void from_json(const json& _j, quicktype::Minmax& _x);
    void to_json(json& _j, const quicktype::Minmax& _x);

    void from_json(const json& _j, quicktype::Union& _x);
    void to_json(json& _j, const quicktype::Union& _x);

    void from_json(const json& _j, quicktype::Properties& _x);
    void to_json(json& _j, const quicktype::Properties& _x);

    void from_json(const json& _j, quicktype::TopLevel& _x);
    void to_json(json& _j, const quicktype::TopLevel& _x);

    inline void from_json(const json& _j, quicktype::Free& _x) {
        _x.set_type( _j.at("type").get<std::string>());
    }

    inline void to_json(json& _j, const quicktype::Free& _x) {
        _j = json::object();
        _j["type"] = _x.get_type();
    }

    inline void from_json(const json& _j, quicktype::Of& _x) {
        _x.set_ref( _j.at("$ref").get<std::string>());
    }

    inline void to_json(json& _j, const quicktype::Of& _x) {
        _j = json::object();
        _j["$ref"] = _x.get_ref();
    }

    inline void from_json(const json& _j, quicktype::Intersection& _x) {
        _x.set_all_of( _j.at("allOf").get<std::vector<quicktype::Of>>());
    }

    inline void to_json(json& _j, const quicktype::Intersection& _x) {
        _j = json::object();
        _j["allOf"] = _x.get_all_of();
    }

    inline void from_json(const json& _j, quicktype::Max& _x) {
        _x.set_type( _j.at("type").get<std::string>());
        _x.set_maximum( _j.at("maximum").get<int64_t>());
    }

    inline void to_json(json& _j, const quicktype::Max& _x) {
        _j = json::object();
        _j["type"] = _x.get_type();
        _j["maximum"] = _x.get_maximum();
    }

    inline void from_json(const json& _j, quicktype::Min& _x) {
        _x.set_type( _j.at("type").get<std::string>());
        _x.set_minimum( _j.at("minimum").get<int64_t>());
    }

    inline void to_json(json& _j, const quicktype::Min& _x) {
        _j = json::object();
        _j["type"] = _x.get_type();
        _j["minimum"] = _x.get_minimum();
    }

    inline void from_json(const json& _j, quicktype::MinMaxUnion& _x) {
        _x.set_one_of( _j.at("oneOf").get<std::vector<quicktype::Of>>());
    }

    inline void to_json(json& _j, const quicktype::MinMaxUnion& _x) {
        _j = json::object();
        _j["oneOf"] = _x.get_one_of();
    }

    inline void from_json(const json& _j, quicktype::Minmax& _x) {
        _x.set_type( quicktype::get_optional<std::string>(_j, "type"));
        _x.set_minimum( quicktype::get_optional<int64_t>(_j, "minimum"));
        _x.set_maximum( quicktype::get_optional<int64_t>(_j, "maximum"));
        _x.set_ref( quicktype::get_optional<std::string>(_j, "$ref"));
    }

    inline void to_json(json& _j, const quicktype::Minmax& _x) {
        _j = json::object();
        _j["type"] = _x.get_type();
        _j["minimum"] = _x.get_minimum();
        _j["maximum"] = _x.get_maximum();
        _j["$ref"] = _x.get_ref();
    }

    inline void from_json(const json& _j, quicktype::Union& _x) {
        _x.set_one_of( _j.at("oneOf").get<std::vector<quicktype::Minmax>>());
    }

    inline void to_json(json& _j, const quicktype::Union& _x) {
        _j = json::object();
        _j["oneOf"] = _x.get_one_of();
    }

    inline void from_json(const json& _j, quicktype::Properties& _x) {
        _x.set_free( _j.at("free").get<quicktype::Free>());
        _x.set_min( _j.at("min").get<quicktype::Min>());
        _x.set_max( _j.at("max").get<quicktype::Max>());
        _x.set_minmax( _j.at("minmax").get<quicktype::Minmax>());
        _x.set_properties_union( _j.at("union").get<quicktype::Union>());
        _x.set_min_max_union( _j.at("minMaxUnion").get<quicktype::MinMaxUnion>());
        _x.set_intersection( _j.at("intersection").get<quicktype::Intersection>());
        _x.set_min_max_intersection( _j.at("minMaxIntersection").get<quicktype::Intersection>());
    }

    inline void to_json(json& _j, const quicktype::Properties& _x) {
        _j = json::object();
        _j["free"] = _x.get_free();
        _j["min"] = _x.get_min();
        _j["max"] = _x.get_max();
        _j["minmax"] = _x.get_minmax();
        _j["union"] = _x.get_properties_union();
        _j["minMaxUnion"] = _x.get_min_max_union();
        _j["intersection"] = _x.get_intersection();
        _j["minMaxIntersection"] = _x.get_min_max_intersection();
    }

    inline void from_json(const json& _j, quicktype::TopLevel& _x) {
        _x.set_type( _j.at("type").get<std::string>());
        _x.set_properties( _j.at("properties").get<quicktype::Properties>());
        _x.set_required( _j.at("required").get<std::vector<std::string>>());
    }

    inline void to_json(json& _j, const quicktype::TopLevel& _x) {
        _j = json::object();
        _j["type"] = _x.get_type();
        _j["properties"] = _x.get_properties();
        _j["required"] = _x.get_required();
    }
}

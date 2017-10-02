module Options
    ( OptionSpecifications
    , OptionSpecification
    , OptionValues
    , OptionValue
    , Option
    , OptionValueExtractor
    , booleanOption
    , stringOption
    , enumOption
    , makeOptionValues
    , lookupOptionValue
    , valueType
    , stringValue
    ) where

import Prelude

import Data.Array ((!!))
import Data.Array as A
import Data.Foldable (elem, intercalate)
import Data.Maybe (Maybe(..), fromJust)
import Data.StrMap (StrMap)
import Data.StrMap as SM
import Data.String as String
import Data.Tuple (Tuple(..), fst)
import Partial.Unsafe (unsafePartial)

-- FIXME: all of this should be strongly typed and not require
-- unsafePartial.

data OptionValue
    = BooleanValue Boolean
    | StringValue String
    | EnumValue Int (Array String)

type OptionSpecification =
    { name :: String
    , description :: String
    , typeLabel :: String
    , default :: OptionValue
    }

type OptionSpecifications = Array OptionSpecification
type OptionValues = StrMap OptionValue

type OptionValueExtractor a = OptionValue -> a

type Option a = { specification :: OptionSpecification, extractor :: OptionValueExtractor a }

valueType :: OptionValue -> String
valueType = case _ of
    BooleanValue _ -> "BooleanValue"
    StringValue _ -> "StringValue"
    EnumValue _ _ -> "EnumValue"

stringValue :: OptionValue -> Maybe String
stringValue = case _ of
    BooleanValue b -> Just $ show b
    StringValue s -> Just s
    EnumValue i xs -> xs !! i

-- FIXME: error handling!
makeOptionValues :: OptionSpecifications -> StrMap String -> OptionValues
makeOptionValues optionSpecifications optionStrings =
    SM.mapWithKey makeOptionValue validOptions
    where
        specMap :: StrMap OptionSpecification
        specMap = SM.fromFoldable $ map (\spec -> Tuple spec.name spec) optionSpecifications

        validOptions :: StrMap String
        validOptions = SM.filterWithKey isValidOption optionStrings

        isValidOption :: String -> String -> Boolean
        isValidOption optionName value = SM.member optionName specMap

        makeOptionValue :: String -> String -> OptionValue
        makeOptionValue name optionString =
            -- Error handling here - we assume the option has a spec
            let spec = unsafePartial $ fromJust $ SM.lookup name specMap
            in
                case spec.default of
                BooleanValue _ ->
                    let l = String.toLower optionString
                    in BooleanValue $ not $ l `elem` ["false", "f", "no", "n", "0"]
                StringValue _ ->
                    StringValue optionString
                EnumValue _ cases ->
                    case A.findIndex (eq optionString) cases of
                    Just i -> EnumValue i cases
                    Nothing -> EnumValue 0 cases -- FIXME: handle error

booleanOption :: String -> String -> Boolean -> Option Boolean
booleanOption name description default =
    { specification:
        { name
        , description
        , typeLabel: "yes|no"
        , default: BooleanValue default
        }
    , extractor: \t -> unsafePartial $ extractor t
    }
    where
        extractor :: Partial => OptionValueExtractor Boolean
        extractor (BooleanValue v) = v

stringOption :: String -> String -> String -> String -> Option String
stringOption name description typeLabel default =
    { specification:
        { name
        , description
        , typeLabel
        , default: StringValue default
        }
    , extractor: \t -> unsafePartial $ extractor t
    }
    where
        extractor :: Partial => OptionValueExtractor String
        extractor (StringValue v) = v

enumOption :: forall a. String -> String -> Array (Tuple String a) -> Option a
enumOption name description cases =
    { specification:
        { name
        , description
        , typeLabel: intercalate "|" caseNames
        , default: EnumValue 0 caseNames
        }
    , extractor: \t -> unsafePartial $ extractor t
    }
    where
        caseNames = map fst cases
        caseMap = SM.fromFoldable cases

        extractor :: Partial => OptionValueExtractor a
        extractor (EnumValue i _) =
            fromJust $ SM.lookup (fromJust $ A.index caseNames i) caseMap

lookupOptionValue :: forall a. Option a -> OptionValues -> a
lookupOptionValue { specification: { name, default }, extractor } optionValues =
    case SM.lookup name optionValues of
    Nothing -> extractor default
    Just v -> extractor v

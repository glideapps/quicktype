module Options
    ( OptionSpecifications
    , OptionSpecification
    , OptionValues
    , OptionValue
    , Option
    , OptionValueExtractor
    , booleanOption
    , enumOption
    , makeOptionValues
    , lookupOptionValue
    ) where

import Prelude

import Data.Array as A
import Data.Foldable (any, elem, intercalate)
import Data.JSON.AST (Literal(..))
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
                    in BooleanValue $ l `elem` ["true", "t", "yes", "y", "1"]
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

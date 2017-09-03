module Options
    ( OptionSpecifications
    , OptionSpecification
    , OptionValues
    , OptionValue
    , Option
    , OptionValueExtractor
    , booleanOption
    , makeOptionValues
    , lookupOptionValue
    ) where

import Prelude

import Data.Maybe (Maybe(..), fromJust)
import Data.StrMap (StrMap)
import Data.StrMap as SM
import Data.Tuple (Tuple(..))
import Data.String as String
import Partial.Unsafe (unsafePartial)

-- FIXME: all of this should be strongly typed and not require
-- unsafePartial.

data OptionValue
    = BooleanValue Boolean

type OptionSpecification =
    { name :: String
    , description :: String
    , default :: OptionValue
    }

type OptionSpecifications = Array OptionSpecification
type OptionValues = StrMap OptionValue

type OptionValueExtractor a = OptionValue -> a

type Option a = { specification :: OptionSpecification, extractor :: OptionValueExtractor a }

-- FIXME: error handling!
makeOptionValues :: OptionSpecifications -> StrMap String -> OptionValues
makeOptionValues optionSpecifications optionStrings =
    SM.mapWithKey makeOptionValue optionStrings
    where
        specMap :: StrMap OptionSpecification
        specMap = SM.fromFoldable $ map (\spec -> Tuple spec.name spec ) optionSpecifications

        makeOptionValue :: String -> String -> OptionValue
        makeOptionValue name optionString =
            -- Error handling here - we assume the option has a spec
            let spec = unsafePartial $ fromJust $ SM.lookup name specMap
            in
                let l = String.toLower optionString
                in BooleanValue $ l == "true" || l == "t" || l == "yes" || l == "y" || l == "1"

booleanOption :: String -> String -> Boolean -> Option Boolean
booleanOption name description default =
    { specification: { name, description, default: BooleanValue default }, extractor }
    where
        extractor (BooleanValue v) = v

lookupOptionValue :: forall a. Option a -> OptionValues -> a
lookupOptionValue { specification: { name, default }, extractor } optionValues =
    case SM.lookup name optionValues of
    Nothing -> extractor default
    Just v -> extractor v

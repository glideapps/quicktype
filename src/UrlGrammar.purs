module UrlGrammar
    ( Grammar
    , GrammarMap(..)
    , generate
    ) where

import Prelude

import Data.Argonaut.Core (JObject, foldJson)
import Data.Argonaut.Decode (class DecodeJson, decodeJson, (.?))
import Data.Array (fold)
import Data.Array as A
import Data.Either (Either(..))
import Data.List (List, (:))
import Data.List as L
import Data.StrMap (StrMap)
import Data.Traversable (class Foldable, traverse)

data Grammar
    = Literal String
    | Sequence (List Grammar)
    | Choice (List Grammar)

newtype GrammarMap = GrammarMap (StrMap Grammar)

generateAllFromSequence :: List Grammar -> List (Array String)
generateAllFromSequence L.Nil = [] : L.Nil
generateAllFromSequence (first : rest) = do
    fromFirst <- generateAll first
    fromRest <- generateAllFromSequence rest
    pure $ A.concat [fromFirst, fromRest]

generateAll :: Grammar -> List (Array String)
generateAll (Literal s) = [s] : L.Nil
generateAll (Sequence l) = generateAllFromSequence l
generateAll (Choice l) = do
    choice <- l
    generateAll choice

generate :: Grammar -> Array String
generate g =
    let all = A.fromFoldable $ generateAll g
    in map fold all

decodeObject :: JObject -> Either String Grammar
decodeObject obj = Choice <$> (obj .? "oneOf")


mkSequence :: forall f. Foldable f => f Grammar -> Grammar
mkSequence = Sequence <<< L.fromFoldable

instance decodeGrammar :: DecodeJson Grammar where
    decodeJson = do
        foldJson
            (\_ -> Left "Grammar cannot be null")
            (\_ -> Left "Grammar cannot be a boolean")
            (\_ -> Left "Grammar cannot be a number")
            (\s -> Right $ Literal s)
            (\a -> mkSequence <$> traverse decodeJson a)
            (\o -> decodeObject o)

instance decodeGrammarMap :: DecodeJson GrammarMap where
    decodeJson j = GrammarMap <$> decodeJson j

module UrlGrammar
    ( Grammar
    , GrammarMap(..)
    , generate
    ) where

import Prelude

import Data.Argonaut.Core (Json, JObject, foldJson, toArray, toObject)
import Data.Argonaut.Decode (class DecodeJson, decodeJson)
import Data.Array as A
import Data.Either (Either(..))
import Data.List (List, (:))
import Data.List as L
import Data.Maybe (Maybe(..))
import Data.StrMap (StrMap)
import Data.StrMap as SM
import Data.Traversable (class Foldable, traverse)
import Data.Tuple (Tuple(..))
import Utils (mapM, mapStrMapM)

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
    in
        map (A.foldl (<>) "") all

decodeObject :: StrMap Json -> Either String Grammar
decodeObject obj =
    case SM.lookup "oneOf" obj of
    Nothing -> Left "Object must have a 'oneOf' field"
    Just x ->
        case toArray x of
        Nothing -> Left "'oneOf' value must be an array"
        Just options -> do
            mapped <- mapM decodeJson options
            pure $ Choice $ L.fromFoldable mapped

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
module Utils
    ( mapM
    , mapMapM
    , mapStrMapM
    , sortByKeyM
    , sortByKey
    , foldError
    , lookupOrDefault
    , removeElement
    , forEnumerated_
    ) where

import Prelude

import Data.Either (Either(..))
import Data.Foldable (find, foldl)
import Data.List (List, (:))
import Data.List as L
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe, maybe)
import Data.Set (Set)
import Data.Set as S
import Data.StrMap (StrMap)
import Data.StrMap as SM
import Data.Traversable (class Foldable, traverse, for_)
import Data.Tuple (Tuple(..))

foldError :: forall a f e. Foldable f => f (Either e a) -> Either e (List a)
foldError items =
    foldl folder (Right L.Nil) items
    where
        folder b a =
            case b of
            Left err -> Left err
            Right xb ->
                case a of
                Left err -> Left err
                Right xa -> Right $ xa : xb

mapM :: forall m a b. Applicative m => (a -> m b) -> List a -> m (List b)
mapM = traverse

mapMapM :: forall m k v w. Monad m => Ord k  => (k -> v -> m w) -> Map k v -> m (Map k w)
mapMapM f m = do
    l <- mapM mapper (M.toUnfoldable m)
    pure $ M.fromFoldable l
    where
        mapper (Tuple a b) = do
            c <- f a b
            pure $ Tuple a c

mapStrMapM :: forall m v w. Monad m => (String -> v -> m w) -> StrMap v -> m (StrMap w)
mapStrMapM f m = do
    l <- mapM mapper (SM.toUnfoldable m)
    pure $ SM.fromFoldable l
    where
        mapper (Tuple a b) = do
            c <- f a b
            pure $ Tuple a c

sortByKey :: forall a b. Ord b => (a -> b) -> List a -> List a
sortByKey keyF = L.sortBy (\a b -> compare (keyF a) (keyF b))

sortByKeyM :: forall a b m. Ord b => Monad m => (a -> m b) -> List a -> m (List a)
sortByKeyM keyF items = do
    itemsWithKeys :: List _ <- mapM (\item -> keyF item >>= (\key -> pure $ { item, key })) items
    let sortedItemsWithKeys = L.sortBy (\a b -> compare a.key b.key) itemsWithKeys
    pure $ map (_.item) sortedItemsWithKeys

lookupOrDefault :: forall k v. Ord k => v -> k -> Map k v -> v
lookupOrDefault default key m = maybe default id $ M.lookup key m

removeElement :: forall a. Ord a => (a -> Boolean) -> Set a -> { element :: Maybe a, rest :: Set a }
removeElement p s = { element, rest: maybe s (\x -> S.delete x s) element }
    where element = find p s 

forEnumerated_ :: forall a b m. Applicative m => List a -> (Int -> a -> m b) -> m Unit
forEnumerated_ l f =
    let lWithIndexes = L.zip (L.range 0 ((L.length l) - 1)) l
    in
        for_ lWithIndexes \(Tuple i x) -> f i x

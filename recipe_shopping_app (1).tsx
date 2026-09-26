import React, { useState, useEffect, useMemo } from 'react';
import { 
  BookOpen, ShoppingCart, PlusCircle, CheckSquare, 
  Square, ChefHat, Trash2, Tag, ListPlus, Loader2, AlertCircle,
  Minus, Plus, X
} from 'lucide-react';

import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, doc, setDoc, onSnapshot, collection, addDoc, deleteDoc 
} from 'firebase/firestore';

// Initialize Firebase outside the component
const firebaseConfig = JSON.parse(
  typeof __firebase_config !== 'undefined' 
    ? __firebase_config 
    : '{"projectId":"mock-project"}'
);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

const COMMON_UNITS = [
  "item(s)", "cup", "tbsp", "tsp", "oz", "lb", "g", "kg", "ml", "L", "pinch", "bunch", "clove"
];

export default function App() {
  // Authentication State
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Application Data State
  const [recipes, setRecipes] = useState([]);
  const [mealPlan, setMealPlan] = useState({}); // { recipeId: count }
  const [pantryItems, setPantryItems] = useState(new Set());
  const [dataLoading, setDataLoading] = useState(true);

  // UI State
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard', 'add', 'shopping'
  const [activeTag, setActiveTag] = useState('All');
  
  // New Recipe Form State
  const [newTitle, setNewTitle] = useState('');
  const [newTags, setNewTags] = useState('');
  const [newIngredients, setNewIngredients] = useState([
    { quantity: 1, unit: 'item(s)', name: '' }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Confirmation UI State
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth error:", error);
      } finally {
        setAuthLoading(false);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setDataLoading(false);
      return;
    }
    setDataLoading(true);

    // 1. Subscribe to recipes
    const recipesRef = collection(db, 'artifacts', appId, 'users', user.uid, 'recipes');
    const unsubRecipes = onSnapshot(recipesRef, (snapshot) => {
      const fetchedRecipes = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      fetchedRecipes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setRecipes(fetchedRecipes);
      setDataLoading(false);
    }, (error) => {
      console.error("Error fetching recipes:", error);
      setDataLoading(false);
    });

    // 2. Subscribe to shopping state (meal plan counts & pantry items)
    const stateRef = doc(db, 'artifacts', appId, 'users', user.uid, 'appState', 'shopping');
    const unsubState = onSnapshot(stateRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setMealPlan(data.mealPlan || {});
        setPantryItems(new Set(data.pantryItems || []));
      } else {
        setMealPlan({});
        setPantryItems(new Set());
      }
    }, (error) => {
      console.error("Error fetching shopping state:", error);
    });

    return () => {
      unsubRecipes();
      unsubState();
    };
  }, [user]);

  const saveShoppingState = async (newMealPlan, newPantry) => {
    if (!user) return;
    try {
      const stateRef = doc(db, 'artifacts', appId, 'users', user.uid, 'appState', 'shopping');
      await setDoc(stateRef, {
        mealPlan: newMealPlan,
        pantryItems: Array.from(newPantry)
      }, { merge: true });
    } catch (error) {
      console.error("Error saving shopping state:", error);
    }
  };

  const updateMealPlanCount = async (recipeId, delta) => {
    const currentCount = mealPlan[recipeId] || 0;
    const newCount = Math.max(0, currentCount + delta); // Prevent negative portions
    
    const newMealPlan = { ...mealPlan };
    if (newCount === 0) {
      delete newMealPlan[recipeId];
    } else {
      newMealPlan[recipeId] = newCount;
    }
    
    setMealPlan(newMealPlan);
    await saveShoppingState(newMealPlan, pantryItems);
  };

  const togglePantryItem = async (ingredientIdKey) => {
    const newPantry = new Set(pantryItems);
    if (newPantry.has(ingredientIdKey)) {
      newPantry.delete(ingredientIdKey);
    } else {
      newPantry.add(ingredientIdKey);
    }
    setPantryItems(newPantry);
    await saveShoppingState(mealPlan, newPantry);
  };

  const clearMealPlan = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    setMealPlan({});
    setPantryItems(new Set());
    setConfirmClear(false);
    await saveShoppingState({}, new Set());
  };

  const handleAddIngredientRow = () => {
    setNewIngredients([...newIngredients, { quantity: 1, unit: 'item(s)', name: '' }]);
  };

  const handleUpdateIngredient = (index, field, value) => {
    const updated = [...newIngredients];
    updated[index][field] = value;
    setNewIngredients(updated);
  };

  const handleRemoveIngredientRow = (index) => {
    const updated = newIngredients.filter((_, i) => i !== index);
    setNewIngredients(updated);
  };

  const handleAddRecipe = async (e) => {
    e.preventDefault();
    if (!user || !newTitle.trim()) return;
    
    // Filter out completely empty rows
    const validIngredients = newIngredients.filter(ing => ing.name.trim() !== '');
    if (validIngredients.length === 0) return;

    setIsSubmitting(true);

    try {
      const parsedTags = newTags
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      const formattedIngredients = validIngredients.map(ing => ({
        quantity: parseFloat(ing.quantity) || 0,
        unit: ing.unit.trim(),
        name: ing.name.trim()
      }));

      const newRecipe = {
        title: newTitle.trim(),
        ingredients: formattedIngredients,
        tags: parsedTags.length > 0 ? parsedTags : ['Uncategorized'],
        createdAt: Date.now()
      };

      const recipesRef = collection(db, 'artifacts', appId, 'users', user.uid, 'recipes');
      await addDoc(recipesRef, newRecipe);

      // Reset Form
      setNewTitle('');
      setNewIngredients([{ quantity: 1, unit: 'item(s)', name: '' }]);
      setNewTags('');
      setActiveTab('dashboard');
    } catch (error) {
      console.error("Error adding recipe:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRecipe = async (id) => {
    if (deleteConfirmId !== id) {
      setDeleteConfirmId(id);
      setTimeout(() => setDeleteConfirmId(null), 3000);
      return;
    }

    if (!user) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'recipes', id));
      
      if (mealPlan[id]) {
        const newMealPlan = { ...mealPlan };
        delete newMealPlan[id];
        setMealPlan(newMealPlan);
        await saveShoppingState(newMealPlan, pantryItems);
      }
      setDeleteConfirmId(null);
    } catch (error) {
      console.error("Error deleting recipe:", error);
    }
  };

  const allTags = useMemo(() => {
    const tags = new Set(['All']);
    recipes.forEach(r => r.tags.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [recipes]);

  const filteredRecipes = useMemo(() => {
    if (activeTag === 'All') return recipes;
    return recipes.filter(r => r.tags.includes(activeTag));
  }, [recipes, activeTag]);

  // The "Math": Aggregating quantities based on portion counts
  const shoppingList = useMemo(() => {
    const combinedMap = new Map();

    Object.entries(mealPlan).forEach(([recipeId, count]) => {
      if (count <= 0) return;
      const recipe = recipes.find(r => r.id === recipeId);
      if (!recipe) return;

      recipe.ingredients.forEach(ing => {
        const normName = ing.name.toLowerCase().trim();
        const normUnit = ing.unit.toLowerCase().trim();
        // Unique key combines unit and name (e.g. "cup_milk")
        const idKey = `${normUnit}_${normName}`;

        if (!combinedMap.has(idKey)) {
          combinedMap.set(idKey, {
            idKey,
            name: ing.name,
            unit: ing.unit,
            quantity: 0
          });
        }
        
        const existing = combinedMap.get(idKey);
        existing.quantity += (ing.quantity * count);
      });
    });

    // Convert to array and sort alphabetically by ingredient name
    return Array.from(combinedMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [recipes, mealPlan]);

  const toBuyList = shoppingList.filter(item => !pantryItems.has(item.idKey));
  const inPantryList = shoppingList.filter(item => pantryItems.has(item.idKey));
  
  // Total portions currently selected across all meals
  const totalPortions = Object.values(mealPlan).reduce((acc, curr) => acc + curr, 0);

  if (authLoading || dataLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center text-slate-500">
        <Loader2 className="animate-spin mb-4 text-emerald-500" size={48} />
        <p className="text-lg font-medium">Loading your kitchen...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans pb-12">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row justify-between items-center py-4 gap-4">
            <div className="flex items-center gap-2 w-full sm:w-auto justify-center sm:justify-start">
              <div className="bg-emerald-500 p-2 rounded-lg text-white shadow-md">
                <ChefHat size={24} />
              </div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">MealPrep Pro</h1>
            </div>
            
            <nav className="flex space-x-2 w-full sm:w-auto justify-center">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`flex flex-1 sm:flex-none justify-center items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'dashboard' ? 'bg-emerald-50 text-emerald-700 shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <BookOpen size={18} />
                <span>Recipes</span>
              </button>
              <button
                onClick={() => setActiveTab('add')}
                className={`flex flex-1 sm:flex-none justify-center items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'add' ? 'bg-emerald-50 text-emerald-700 shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <PlusCircle size={18} />
                <span>Add</span>
              </button>
              <button
                onClick={() => setActiveTab('shopping')}
                className={`flex flex-1 sm:flex-none justify-center items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'shopping' ? 'bg-emerald-50 text-emerald-700 shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <div className="relative">
                  <ShoppingCart size={18} />
                  {totalPortions > 0 && (
                    <span className="absolute -top-2 -right-2 bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ring-2 ring-white">
                      {totalPortions}
                    </span>
                  )}
                </div>
                <span>List</span>
              </button>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {activeTab === 'dashboard' && (
          <div className="animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Your Recipes</h2>
                <p className="text-slate-500 text-sm mt-1">Select portions to build your meal plan.</p>
              </div>
              
              <div className="flex flex-wrap gap-2">
                {allTags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => setActiveTag(tag)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                      activeTag === tag 
                        ? 'bg-emerald-600 text-white shadow-md' 
                        : 'bg-white text-slate-600 border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {filteredRecipes.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-slate-200 border-dashed">
                <BookOpen size={48} className="mx-auto text-slate-300 mb-4" />
                <h3 className="text-lg font-medium text-slate-900">No recipes found</h3>
                <p className="text-slate-500 mt-2 mb-6">
                  {recipes.length === 0 
                    ? "Your recipe book is empty. Let's add some delicious meals!" 
                    : "No recipes match this tag."}
                </p>
                {recipes.length === 0 && (
                  <button
                    onClick={() => setActiveTab('add')}
                    className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-lg font-medium transition-colors shadow-sm"
                  >
                    <PlusCircle size={18} />
                    Add First Recipe
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredRecipes.map(recipe => {
                  const portionCount = mealPlan[recipe.id] || 0;
                  const isSelected = portionCount > 0;
                  
                  return (
                    <div 
                      key={recipe.id} 
                      className={`relative flex flex-col bg-white rounded-2xl shadow-sm border transition-all duration-300 overflow-hidden ${
                        isSelected ? 'border-emerald-500 ring-1 ring-emerald-500 shadow-emerald-100' : 'border-slate-200 hover:border-emerald-300 hover:shadow-md'
                      }`}
                    >
                      <div className="p-5 flex-grow">
                        <div className="flex justify-between items-start mb-3 gap-2">
                          <h3 className="text-lg font-bold text-slate-900 leading-tight">{recipe.title}</h3>
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleDeleteRecipe(recipe.id); }}
                            className={`p-1.5 rounded-md transition-colors flex-shrink-0 ${
                              deleteConfirmId === recipe.id 
                                ? 'bg-rose-100 text-rose-600 hover:bg-rose-200' 
                                : 'text-slate-400 hover:bg-slate-100 hover:text-rose-500'
                            }`}
                            title={deleteConfirmId === recipe.id ? "Click again to confirm deletion" : "Delete Recipe"}
                          >
                            {deleteConfirmId === recipe.id ? <AlertCircle size={18} /> : <Trash2 size={18} />}
                          </button>
                        </div>
                        
                        <div className="flex flex-wrap gap-1.5 mb-4">
                          {recipe.tags.map(tag => (
                            <span key={tag} className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-600">
                              {tag}
                            </span>
                          ))}
                        </div>
                        
                        <p className="text-sm font-semibold text-slate-700 mb-2">Ingredients ({recipe.ingredients.length}):</p>
                        <ul className="text-sm text-slate-600 space-y-1.5 mb-2">
                          {recipe.ingredients.slice(0, 4).map((ing, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className="text-emerald-500 text-[8px] mt-2">●</span>
                              <span className="truncate">
                                {ing.quantity} {ing.unit} {ing.name}
                              </span>
                            </li>
                          ))}
                          {recipe.ingredients.length > 4 && (
                            <li className="text-xs text-slate-400 italic mt-1 ml-4">
                              + {recipe.ingredients.length - 4} more items...
                            </li>
                          )}
                        </ul>
                      </div>
                      
                      <div className="p-4 bg-slate-50 border-t border-slate-100 mt-auto flex flex-col items-center">
                        <span className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">Portions for Grocery List</span>
                        <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl p-1 shadow-sm w-full justify-between">
                          <button 
                            onClick={() => updateMealPlanCount(recipe.id, -1)}
                            className="p-2 rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                            disabled={portionCount === 0}
                          >
                            <Minus size={20} />
                          </button>
                          
                          <div className="flex flex-col items-center w-12">
                            <span className={`text-xl font-bold ${isSelected ? 'text-emerald-600' : 'text-slate-400'}`}>
                              {portionCount}
                            </span>
                          </div>
                          
                          <button 
                            onClick={() => updateMealPlanCount(recipe.id, 1)}
                            className="p-2 rounded-lg text-slate-500 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                          >
                            <Plus size={20} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'add' && (
          <div className="max-w-3xl mx-auto animate-in fade-in duration-500">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-200 bg-slate-50 flex items-center gap-3">
                <div className="bg-white p-2 rounded-lg shadow-sm">
                  <PlusCircle size={20} className="text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Create New Recipe</h2>
                  <p className="text-sm text-slate-500 mt-0.5">Add structured ingredients to make the smart list work.</p>
                </div>
              </div>
              
              <form onSubmit={handleAddRecipe} className="p-6 md:p-8 space-y-6">
                <div>
                  <label htmlFor="title" className="block text-sm font-bold text-slate-700 mb-1.5">
                    Recipe Title
                  </label>
                  <input
                    id="title"
                    type="text"
                    required
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="e.g., Egg and Toast Breakfast"
                    className="w-full rounded-xl border-slate-300 border px-4 py-3 text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all shadow-sm"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-end mb-3">
                    <label className="block text-sm font-bold text-slate-700">
                      Ingredients
                    </label>
                  </div>
                  
                  <div className="space-y-3">
                    {newIngredients.map((ing, idx) => (
                      <div key={idx} className="flex gap-2 items-center group">
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          required
                          value={ing.quantity}
                          onChange={(e) => handleUpdateIngredient(idx, 'quantity', e.target.value)}
                          className="w-20 rounded-lg border-slate-300 border px-3 py-2.5 text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                          placeholder="Qty"
                        />
                        <select
                          value={ing.unit}
                          onChange={(e) => handleUpdateIngredient(idx, 'unit', e.target.value)}
                          className="w-28 rounded-lg border-slate-300 border px-2 py-2.5 text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all bg-white"
                        >
                          {COMMON_UNITS.map(u => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          required
                          value={ing.name}
                          onChange={(e) => handleUpdateIngredient(idx, 'name', e.target.value)}
                          className="flex-1 rounded-lg border-slate-300 border px-3 py-2.5 text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                          placeholder="e.g., Eggs, Bread, Butter"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveIngredientRow(idx)}
                          disabled={newIngredients.length === 1}
                          className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                          <X size={20} />
                        </button>
                      </div>
                    ))}
                  </div>
                  
                  <button
                    type="button"
                    onClick={handleAddIngredientRow}
                    className="mt-4 flex items-center gap-2 text-sm font-bold text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-4 py-2 rounded-lg transition-colors"
                  >
                    <Plus size={16} />
                    Add Another Ingredient
                  </button>
                </div>

                <div>
                  <label htmlFor="tags" className="block text-sm font-bold text-slate-700 mb-1.5">
                    Tags (Optional)
                  </label>
                  <p className="text-xs text-slate-500 mb-3 font-medium">Separate tags with commas.</p>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Tag size={18} className="text-slate-400" />
                    </div>
                    <input
                      id="tags"
                      type="text"
                      value={newTags}
                      onChange={(e) => setNewTags(e.target.value)}
                      placeholder="Breakfast, Quick, Vegetarian"
                      className="w-full rounded-xl border-slate-300 border pl-11 pr-4 py-3 text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all shadow-sm"
                    />
                  </div>
                </div>

                <div className="pt-6 border-t border-slate-100 flex justify-end">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white px-8 py-3 rounded-xl font-bold transition-colors shadow-sm focus:ring-4 focus:ring-emerald-500/20 w-full sm:w-auto justify-center"
                  >
                    {isSubmitting ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : (
                      <PlusCircle size={20} />
                    )}
                    {isSubmitting ? 'Saving...' : 'Save Recipe'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'shopping' && (
          <div className="max-w-3xl mx-auto animate-in fade-in duration-500">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Grocery List</h2>
                <p className="text-slate-500 text-sm mt-1 font-medium">
                  {totalPortions === 0 
                    ? 'No meals selected for your plan.' 
                    : `Aggregated ingredients for ${totalPortions} planned portion${totalPortions > 1 ? 's' : ''}.`}
                </p>
              </div>
              
              {totalPortions > 0 && (
                <button
                  onClick={clearMealPlan}
                  className={`flex items-center gap-2 text-sm font-bold px-4 py-2 rounded-lg transition-colors border shadow-sm ${
                    confirmClear 
                      ? 'bg-rose-600 text-white border-rose-600 hover:bg-rose-700' 
                      : 'bg-white text-rose-600 border-slate-200 hover:bg-rose-50'
                  }`}
                >
                  {confirmClear ? (
                    <>
                      <AlertCircle size={16} />
                      Confirm Clear
                    </>
                  ) : (
                    <>
                      <Trash2 size={16} />
                      Clear Plan
                    </>
                  )}
                </button>
              )}
            </div>

            {totalPortions === 0 ? (
              <div className="text-center py-20 bg-white rounded-2xl shadow-sm border border-slate-200 border-dashed">
                <div className="inline-block bg-slate-50 p-4 rounded-full mb-4">
                  <ShoppingCart size={48} className="text-slate-300" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">Your list is empty</h3>
                <p className="text-slate-500 mt-2 max-w-md mx-auto text-sm">
                  Go to the Recipes dashboard and adjust the portions on your favorite meals to dynamically generate your shopping list.
                </p>
                <button
                  onClick={() => setActiveTab('dashboard')}
                  className="mt-8 inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl font-bold transition-colors shadow-sm"
                >
                  Browse Recipes
                </button>
              </div>
            ) : (
              <div className="space-y-8">
                
                {/* To Buy Section */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2 text-lg">
                      <div className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-sm"></div>
                      Need to Buy
                      <span className="ml-2 bg-slate-200 text-slate-600 text-xs px-2 py-0.5 rounded-full">
                        {toBuyList.length}
                      </span>
                    </h3>
                  </div>
                  
                  {toBuyList.length === 0 ? (
                    <div className="p-10 text-center text-slate-500 font-medium">
                      <CheckSquare size={32} className="mx-auto text-emerald-400 mb-3 opacity-50" />
                      Awesome! You have everything you need in your pantry.
                    </div>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {toBuyList.map((item) => (
                        <li 
                          key={item.idKey}
                          onClick={() => togglePantryItem(item.idKey)}
                          className="flex items-center gap-4 p-4 px-6 hover:bg-slate-50 cursor-pointer transition-colors group"
                        >
                          <div className="text-slate-300 group-hover:text-emerald-500 transition-colors flex-shrink-0">
                            <Square size={24} />
                          </div>
                          <div className="flex-1 flex items-baseline gap-2">
                            <span className="text-emerald-600 font-bold text-lg min-w-[3rem] text-right">
                              {Number.isInteger(item.quantity) ? item.quantity : item.quantity.toFixed(1)}
                            </span>
                            <span className="text-slate-500 text-sm font-medium w-16">
                              {item.unit}
                            </span>
                            <span className="text-slate-800 font-medium text-lg capitalize">
                              {item.name}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Pantry Section */}
                {inPantryList.length > 0 && (
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden opacity-80 hover:opacity-100 transition-opacity">
                    <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                      <h3 className="font-bold text-slate-800 flex items-center gap-2 text-lg">
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm"></div>
                        Already Have
                        <span className="ml-2 bg-slate-200 text-slate-600 text-xs px-2 py-0.5 rounded-full">
                          {inPantryList.length}
                        </span>
                      </h3>
                    </div>
                    
                    <ul className="divide-y divide-slate-100">
                      {inPantryList.map((item) => (
                        <li 
                          key={item.idKey}
                          onClick={() => togglePantryItem(item.idKey)}
                          className="flex items-center gap-4 p-4 px-6 hover:bg-slate-50 cursor-pointer transition-colors group"
                        >
                          <div className="text-emerald-500 flex-shrink-0">
                            <CheckSquare size={24} />
                          </div>
                          <div className="flex-1 flex items-baseline gap-2 opacity-50 line-through">
                            <span className="font-bold text-lg min-w-[3rem] text-right">
                              {Number.isInteger(item.quantity) ? item.quantity : item.quantity.toFixed(1)}
                            </span>
                            <span className="text-slate-500 text-sm font-medium w-16">
                              {item.unit}
                            </span>
                            <span className="text-slate-800 font-medium text-lg capitalize">
                              {item.name}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}